// ============================================
// 🤖 BOT FACÇÃO PRO — Sistema de Metas, Painéis e Configuração
// ============================================

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const fs = require("fs");
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot da facção ativo! ✅"));
app.listen(3000, () => console.log("🌐 Servidor web ativo para Render."));

let config = require("./config.json");

const db = new sqlite3.Database("./meta.db");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

db.run("CREATE TABLE IF NOT EXISTS metas (user TEXT, quantidade INTEGER, imagem TEXT)");

client.once("ready", async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("painel").setDescription("Exibe o painel principal."),
    new SlashCommandBuilder().setName("meta").setDescription("Mostra sua meta semanal."),
    new SlashCommandBuilder().setName("ranking").setDescription("Mostra o ranking semanal."),
    new SlashCommandBuilder().setName("depositar").setDescription("Depositar farm + print obrigatório."),
    new SlashCommandBuilder().setName("config").setDescription("Painel administrativo (apenas admins)."),
    new SlashCommandBuilder().setName("ajuda").setDescription("Mostra todos os comandos e explicações.")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  cron.schedule(config.cron.rankingSemanal, enviarRankingSemanal, { timezone: "America/Sao_Paulo" });
  cron.schedule(config.cron.resetSemanal, enviarRelatorioEMeta, { timezone: "America/Sao_Paulo" });

  console.log("🕒 Cron semanal ativo.");
});

// ============ INTERAÇÕES SLASH ============
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild, channel } = interaction;

  // /ajuda
  if (commandName === "ajuda") {
    const embed = new EmbedBuilder()
      .setTitle("📘 Central de Ajuda — Sistema de Metas da Facção")
      .setDescription("Comandos disponíveis organizados por categoria:")
      .addFields(
        { name: "👤 **Comandos de Usuário**", value: "🎯 `/painel` — Exibe o painel e cria sala privada.\n💰 `/depositar` — Registrar valor farmado + print.\n📊 `/meta` — Ver seu progresso semanal.\n🏆 `/ranking` — Mostrar ranking semanal." },
        { name: "🛠 **Comandos de Administrador**", value: "⚙️ `/config` — Painel administrativo interativo." }
      )
      .setColor(config.cores.painel)
      .setFooter({ text: "Bot Facção Pro — Sempre ativo 24h via Render" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // /painel
  if (commandName === "painel") {
    const embed = new EmbedBuilder()
      .setTitle("🎯 Painel de Metas da Facção")
      .setDescription("Escolha uma das opções abaixo para interagir com o sistema.")
      .setColor(config.cores.painel);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("criar_sala").setLabel("Criar Sala Privada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("abrir_ajuda").setLabel("📘 Ver Comandos").setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // /meta
  if (commandName === "meta") {
    const cargo = member.roles.cache.find(r => config.metas[r.name]);
    const meta = cargo ? config.metas[cargo.name] : 1500;
    db.get("SELECT * FROM metas WHERE user = ?", [member.id], (err, row) => {
      if (!row)
        return interaction.reply({ content: `📊 Você ainda não começou sua meta! Faltam **${meta}**.`, ephemeral: true });
      const falta = Math.max(0, meta - row.quantidade);
      interaction.reply({
        content: `📅 Meta semanal:\n- Cargo: ${cargo?.name || "Membro"}\n- Farmado: **${row.quantidade}**\n- Falta: **${falta}**`,
        ephemeral: true,
      });
    });
  }

  // /ranking
  if (commandName === "ranking") {
    enviarRanking(interaction.channel);
    interaction.reply({ content: "🏆 Ranking enviado no canal!", ephemeral: true });
  }

  // /depositar
  if (commandName === "depositar") {
    const embed = new EmbedBuilder()
      .setTitle("💰 Registrar Farm")
      .setDescription("Envie **nesta sala**:\n1️⃣ Valor farmado\n2️⃣ Print como anexo 📸\n\nExemplo: `1500` + imagem")
      .setColor(config.cores.relatorio);
    await interaction.reply({ embeds: [embed], ephemeral: true });

    const filter = m => m.author.id === member.id;
    const collector = channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on("collect", msg => {
      const qtd = parseInt(msg.content.trim());
      const anexo = msg.attachments.first();
      if (isNaN(qtd) || !anexo) return msg.reply("⚠️ Envie número + print. Tente novamente.");
      const imagemURL = anexo.url;
      db.get("SELECT * FROM metas WHERE user = ?", [msg.author.id], (err, row) => {
        if (row)
          db.run("UPDATE metas SET quantidade = ?, imagem = ? WHERE user = ?", [row.quantidade + qtd, imagemURL, msg.author.id]);
        else db.run("INSERT INTO metas (user, quantidade, imagem) VALUES (?, ?, ?)", [msg.author.id, qtd, imagemURL]);
        msg.reply(`✅ Farm registrado com sucesso! +${qtd} adicionados.`);
        console.log(`💰 ${msg.author.tag} depositou ${qtd}.`);
      });
    });

    collector.on("end", c => {
      if (!c.size) interaction.followUp({ content: "⏰ Tempo esgotado! Use o painel novamente.", ephemeral: true });
    });
  }

  // /config
  if (commandName === "config") {
    if (!member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "❌ Apenas administradores podem usar este comando.", ephemeral: true });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("config_opcao")
      .setPlaceholder("Selecione o que deseja alterar")
      .addOptions(
        { label: "🎯 Metas por cargo", value: "metas" },
        { label: "🎨 Cores dos embeds", value: "cores" },
        { label: "📢 Canais fixos", value: "canais" }
      );

    const row = new ActionRowBuilder().addComponents(menu);
    const embed = new EmbedBuilder()
      .setTitle("⚙️ Painel Administrativo")
      .setDescription("Selecione abaixo o que deseja configurar.")
      .setColor("#FFD700");

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
});

// ============ BOTÕES ============
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // botão Ver comandos
  if (interaction.customId === "abrir_ajuda") {
    const embed = new EmbedBuilder()
      .setTitle("📘 Central de Comandos")
      .addFields(
        { name: "👤 Comandos de Usuário", value: "🎯 `/painel` — Abre painel\n💰 `/depositar` — Registrar farm\n📊 `/meta` — Ver meta\n🏆 `/ranking` — Ver ranking" },
        { name: "🛠 Administrador", value: "⚙️ `/config` — Gerenciar metas, cores e canais" }
      )
      .setColor(config.cores.painel);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // botão criar_sala
  if (interaction.customId === "criar_sala") {
    const guild = interaction.guild;
    const membro = interaction.member;
    const nickname = membro.displayName || membro.user.username;

    // impede duplicatas
    const jaExiste = guild.channels.cache.find(c => c.name === `privado-${nickname.toLowerCase().replace(/\s+/g, "-")}`);
    if (jaExiste) return interaction.reply({ content: "⚠️ Você já tem um canal privado criado.", ephemeral: true });

    try {
      const maxPosition = guild.channels.cache.reduce((max, c) => Math.max(max, c.position), 0);

const canalPrivado = await guild.channels.create({
  name: `privado-${nickname.toLowerCase().replace(/\s+/g, "-")}`,
  type: 0,
  position: maxPosition + 1, // cria depois de todos
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: membro.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          ...guild.roles.cache
            .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator))
            .map(r => ({ id: r.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }))
        ]
      });

      const embed = new EmbedBuilder()
        .setTitle("🎯 Painel de Metas da Facção")
        .setDescription("Escolha uma das opções abaixo:")
        .addFields(
          { name: "💰 Depositar farm", value: "Envie o valor e o print." },
          { name: "📊 Ver metas", value: "Veja sua meta semanal." },
          { name: "🏆 Ranking", value: "Confira o ranking da semana." }
        )
        .setColor(config.cores.painel);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("painel_depositar").setLabel("💰 Depositar").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("painel_meta").setLabel("📊 Ver Meta").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("painel_ranking").setLabel("🏆 Ranking").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("abrir_ajuda").setLabel("📘 Ver Comandos").setStyle(ButtonStyle.Secondary)
      );

      await canalPrivado.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: `✅ Canal criado com sucesso: ${canalPrivado}`, ephemeral: true });
      console.log(`📁 Canal criado para ${membro.user.tag}`);
    } catch (err) {
      console.error("Erro ao criar canal:", err);
      await interaction.reply({ content: "❌ Erro ao criar canal privado.", ephemeral: true });
    }
  }
});

// ======== FUNÇÕES AUXILIARES ========
function enviarRanking(channel = null) {
  db.all("SELECT * FROM metas ORDER BY quantidade DESC", [], (err, rows) => {
    if (!rows.length) return channel?.send("Ainda não há depósitos.");
    const lista = rows.map((r, i) => `${i + 1}. <@${r.user}> — **${r.quantidade}**\n📸 [Print](${r.imagem})`).join("\n\n");
    const embed = new EmbedBuilder().setTitle("🏆 Ranking Semanal").setDescription(lista).setColor(config.cores.ranking);
    const canal = channel || client.channels.cache.get(config.canais.ranking);
    canal?.send({ embeds: [embed] });
  });
}

function enviarRankingSemanal() {
  console.log("📤 Enviando ranking semanal automático...");
  enviarRanking();
}

function enviarRelatorioEMeta() {
  db.all("SELECT * FROM metas", [], (err, rows) => {
    const canal = client.channels.cache.get(config.canais.resultado);
    if (!canal) return console.log("❌ Canal de resultados não encontrado.");

    const ok = [], fail = [];
    rows.forEach(r => {
      const membro = client.guilds.cache.first()?.members.cache.get(r.user);
      if (!membro) return;
      const cargo = membro.roles.cache.find(role => config.metas[role.name]);
      const meta = cargo ? config.metas[cargo.name] : 1500;
      if (r.quantidade >= meta) ok.push(`<@${r.user}> ✅ (${r.quantidade}/${meta})`);
      else fail.push(`<@${r.user}> ❌ (${r.quantidade}/${meta})`);
    });

    const embed = new EmbedBuilder()
      .setTitle("📊 Relatório Semanal")
      .setDescription(`**✅ Bateram:**\n${ok.join("\n") || "Ninguém"}\n\n**❌ Não bateram:**\n${fail.join("\n") || "Ninguém"}`)
      .setColor(config.cores.relatorio);

    canal.send({ embeds: [embed] });
    db.run("DELETE FROM metas");
    console.log("🔄 Metas resetadas.");
  });
}

client.login(process.env.DISCORD_TOKEN);
