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

  // !ranking
  if (msg.content.startsWith("!ranking")) {
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
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "criar_sala") return;

  const guild = interaction.guild;
  const membro = interaction.member;

  const categoria = guild.channels.cache.find(c => c.type === 4 && c.name.toLowerCase().includes("facção"));
  const canal = await guild.channels.create({
    name: `verificação-${membro.user.username}`,
    type: 0,
    parent: categoria?.id || null,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: membro.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      ...guild.roles.cache
        .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator))
        .map(r => ({ id: r.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }))
    ]
  });

  await interaction.reply({ content: `✅ Sua sala foi criada: ${canal}`, ephemeral: true });
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

client.login(process.env.DISCORD_TOKEN);
