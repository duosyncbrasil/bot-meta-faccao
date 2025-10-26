const { 
  Client, 
  GatewayIntentBits, 
  PermissionsBitField, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder 
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const moment = require("moment-timezone");

const db = new sqlite3.Database("./meta.db");

// IDs dos canais
const CANAL_RANKING_ID = "1431389740736843857";
const CANAL_RESULTADO_ID = "1431392854621552862";

// Metas por cargo
const METAS = {
  "Sub-líder": 500,
  "Gerente": 1000,
  "Membro": 1500
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
});

db.run("CREATE TABLE IF NOT EXISTS metas (user TEXT, quantidade INTEGER, imagem TEXT)");

client.once("ready", () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  
  // CRON 1 — Enviar ranking todo domingo 23:55 horário de Brasília
  cron.schedule("55 23 * * 0", () => {
    enviarRankingSemanal();
  }, { timezone: "America/Sao_Paulo" });

  // CRON 2 — Resetar segunda 00h e enviar relatório de metas
  cron.schedule("0 0 * * 1", () => {
    enviarRelatorioEMeta();
  }, { timezone: "America/Sao_Paulo" });

  console.log("🕒 Tarefas automáticas de reset e ranking ativadas.");
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const args = msg.content.trim().split(/ +/);

  // !depositar <quantidade> + print
  if (msg.content.startsWith("!depositar")) {
    const qtd = parseInt(args[1]);
    const anexo = msg.attachments.first();

    if (isNaN(qtd)) return msg.reply("⚠️ Use: `!depositar <quantidade>` e anexe um print.");
    if (!anexo) return msg.reply("📸 Você precisa **anexar um print** junto com o comando.");

    const imagemURL = anexo.url;

    db.get("SELECT * FROM metas WHERE user = ?", [msg.author.id], (err, row) => {
      if (row) {
        db.run("UPDATE metas SET quantidade = ?, imagem = ? WHERE user = ?", [row.quantidade + qtd, imagemURL, msg.author.id]);
      } else {
        db.run("INSERT INTO metas (user, quantidade, imagem) VALUES (?, ?, ?)", [msg.author.id, qtd, imagemURL]);
      }
      msg.reply(`💰 Você depositou **${qtd}**! Print salvo ✅`);
    });
  }

  // !rank
  if (msg.content.startsWith("!rank")) {
    enviarRanking(msg.channel);
  }

  // !meta
  if (msg.content.startsWith("!meta")) {
    const membro = msg.guild.members.cache.get(msg.author.id);
    const cargo = membro.roles.cache.find(r => METAS[r.name]);
    const meta = cargo ? METAS[cargo.name] : 1500;

    db.get("SELECT * FROM metas WHERE user = ?", [msg.author.id], (err, row) => {
      if (!row) {
        msg.reply(`📊 Você ainda não começou sua meta! Faltam **${meta}**.`);
      } else {
        const falta = Math.max(0, meta - row.quantidade);
        msg.reply(`📅 Sua meta semanal:\n- Cargo: ${cargo?.name || "Membro"}\n- Farmado: **${row.quantidade}**\n- Falta: **${falta}**`);
      }
    });
  }

  // !painel
  if (msg.content.startsWith("!painel")) {
    const embed = new EmbedBuilder()
      .setTitle("🎯 Sistema de Metas da Facção")
      .setDescription("Clique no botão abaixo para **criar sua sala privada** com a liderança.\n\nUse `!depositar` para registrar seus farms semanais.")
      .setColor("#00FFFF");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("criar_sala")
        .setLabel("Criar Sala Privada")
        .setStyle(ButtonStyle.Primary)
    );

    msg.channel.send({ embeds: [embed], components: [row] });
  }
});

// BOTÃO: criar sala privada
// BOTÃO: criar canal privado no final do servidor com apelido
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "criar_sala") return;

  const guild = interaction.guild;
  const membro = interaction.member;
  const nickname = membro.displayName || membro.user.username;

  try {
    const ultimaPosicao = guild.channels.cache.size;

    const canalPrivado = await guild.channels.create({
      name: `privado-${nickname.toLowerCase().replace(/\s+/g, "-")}`,
      type: 0,
      position: ultimaPosicao,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: membro.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        ...guild.roles.cache
          .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator))
          .map(r => ({
            id: r.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }))
      ]
    });

// BOTÕES do painel interativo
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, member, channel } = interaction;

  // Ver metas
  if (customId === "painel_meta") {
    const cargo = member.roles.cache.find(r => METAS[r.name]);
    const meta = cargo ? METAS[cargo.name] : 1500;

    db.get("SELECT * FROM metas WHERE user = ?", [member.id], (err, row) => {
      if (!row) {
        return interaction.reply({
          content: `📊 Você ainda não começou sua meta! Faltam **${meta}**.`,
          ephemeral: true
        });
      }
      const falta = Math.max(0, meta - row.quantidade);
      interaction.reply({
        content: `📅 Sua meta semanal:\n- Cargo: ${cargo?.name || "Membro"}\n- Farmado: **${row.quantidade}**\n- Falta: **${falta}**`,
        ephemeral: true
      });
    });
  }

  // Ranking
  if (customId === "painel_ranking") {
    db.all("SELECT * FROM metas ORDER BY quantidade DESC", [], (err, rows) => {
      if (!rows.length) {
        return interaction.reply({ content: "Ainda não há depósitos esta semana.", ephemeral: true });
      }
      const lista = rows
        .map((r, i) => `${i + 1}. <@${r.user}> — **${r.quantidade}**`)
        .join("\n");
      interaction.reply({
        embeds: [new EmbedBuilder().setTitle("🏆 Ranking Semanal").setDescription(lista).setColor("#FFD700")],
        ephemeral: true
      });
    });
  }

  // Depositar farm
  if (customId === "painel_depositar") {
    const embed = new EmbedBuilder()
      .setTitle("💰 Registrar Farm")
      .setDescription("Envie uma mensagem **logo abaixo** deste embed com:\n\n1️⃣ A quantia farmada\n2️⃣ O print da tela como anexo\n\nExemplo: `1500` + anexo 📸")
      .setColor("#00FF88");

    await interaction.reply({ embeds: [embed], ephemeral: true });

    const filter = m => m.author.id === member.id;
    const collector = channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on("collect", msg => {
      const qtd = parseInt(msg.content.trim());
      const anexo = msg.attachments.first();
      if (isNaN(qtd) || !anexo) {
        msg.reply("⚠️ Você precisa enviar um número e um print. Tente novamente usando o painel.");
        return;
      }

      db.get("SELECT * FROM metas WHERE user = ?", [msg.author.id], (err, row) => {
        const imagemURL = anexo.url;
        if (row) {
          db.run("UPDATE metas SET quantidade = ?, imagem = ? WHERE user = ?", [row.quantidade + qtd, imagemURL, msg.author.id]);
        } else {
          db.run("INSERT INTO metas (user, quantidade, imagem) VALUES (?, ?, ?)", [msg.author.id, qtd, imagemURL]);
        }
        msg.reply(`✅ Farm registrado com sucesso! +${qtd} adicionados.`);
      });
    });

    collector.on("end", collected => {
      if (!collected.size) interaction.followUp({ content: "⏰ Tempo esgotado! Use o painel novamente para tentar.", ephemeral: true });
    });
  }
});

    // Envia o painel dentro do canal criado
    const embed = new EmbedBuilder()
      .setTitle("🎯 Painel de Metas da Facção")
      .setDescription("Escolha uma das opções abaixo para interagir com o sistema de metas:")
      .addFields(
        { name: "💰 Depositar farm", value: "Envie o valor e o print para registrar seu progresso." },
        { name: "📊 Ver metas", value: "Veja quanto falta para bater sua meta semanal." },
        { name: "🏆 Ranking", value: "Confira quem está no topo do ranking da semana." }
      )
      .setColor("#00FFFF");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("painel_depositar").setLabel("💰 Depositar Farm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("painel_meta").setLabel("📊 Ver Meta").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("painel_ranking").setLabel("🏆 Ranking").setStyle(ButtonStyle.Secondary)
    );

    await canalPrivado.send({ embeds: [embed], components: [row] });

    await interaction.reply({
      content: `✅ Canal privado criado com sucesso: ${canalPrivado}`,
      ephemeral: true
    });
  } catch (err) {
    console.error("Erro ao criar canal privado:", err);
    await interaction.reply({
      content: "❌ Ocorreu um erro ao criar seu canal privado.",
      ephemeral: true
    });
  }
});

// ======== FUNÇÕES AUXILIARES ========

function enviarRanking(channel = null) {
  db.all("SELECT * FROM metas ORDER BY quantidade DESC", [], (err, rows) => {
    if (!rows.length) {
      if (channel) channel.send("Ainda não há depósitos esta semana.");
      return;
    }

    const lista = rows
      .map((r, i) => `${i + 1}. <@${r.user}> — **${r.quantidade}**\n📸 [Print](${r.imagem})`)
      .join("\n\n");

    const embed = new EmbedBuilder()
      .setTitle("🏆 Ranking Semanal")
      .setDescription(lista)
      .setColor("#FFD700")
      .setTimestamp();

    const canal = channel || client.channels.cache.get(CANAL_RANKING_ID);
    canal.send({ embeds: [embed] });
  });
}

function enviarRankingSemanal() {
  console.log("📤 Enviando ranking semanal automático...");
  enviarRanking();
}

function enviarRelatorioEMeta() {
  db.all("SELECT * FROM metas", [], (err, rows) => {
    const canal = client.channels.cache.get(CANAL_RESULTADO_ID);
    if (!canal) return console.log("❌ Canal de resultados não encontrado.");

    const membrosQueBateram = [];
    const membrosNaoBateram = [];

    rows.forEach(r => {
      const membro = client.guilds.cache.first()?.members.cache.get(r.user);
      if (!membro) return;

      const cargo = membro.roles.cache.find(role => METAS[role.name]);
      const meta = cargo ? METAS[cargo.name] : 1500;

      if (r.quantidade >= meta) membrosQueBateram.push(`<@${r.user}> ✅ (${r.quantidade}/${meta})`);
      else membrosNaoBateram.push(`<@${r.user}> ❌ (${r.quantidade}/${meta})`);
    });

    const embed = new EmbedBuilder()
      .setTitle("📊 Relatório Semanal de Metas")
      .setDescription(
        `**✅ Bateram a meta:**\n${membrosQueBateram.join("\n") || "Ninguém"}\n\n` +
        `**❌ Não bateram a meta:**\n${membrosNaoBateram.join("\n") || "Ninguém"}`
      )
      .setColor("#00FF88")
      .setTimestamp();

    canal.send({ embeds: [embed] });

    db.run("DELETE FROM metas");
    console.log("🔄 Metas resetadas após relatório semanal!");
  });
}

const config = require("./config.json");

client.login(process.env.DISCORD_TOKEN);
