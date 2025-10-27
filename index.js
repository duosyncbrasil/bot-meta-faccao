// ============================================
// 🤖 BOT FACÇÃO PRO — Sistema de Metas e Painéis
// Otimizado para Render.com (uptime 24/7)
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
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();
const cron = require("node-cron");
const fs = require("fs");
const express = require("express");
const app = express();

// ====== Servidor Express para Render ======
app.get("/", (_, res) => res.send("✅ Bot Facção Pro ativo e online!"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`[WEB] 🌐 Servidor HTTP ativo na porta ${PORT}`)
);

// ====== Configurações ======
const config = require("./config.json");
const db = new sqlite3.Database("./meta.db", err => {
  if (err) console.error("[DB] Erro ao abrir banco:", err);
  else console.log("[DB] Banco de dados conectado.");
});

db.run(
  "CREATE TABLE IF NOT EXISTS metas (user TEXT, quantidade INTEGER, imagem TEXT)"
);

// ====== Cliente Discord ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ====== Registro de comandos ======
client.once("ready", async () => {
  console.log(`[BOT] ✅ Logado como ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder().setName("painel").setDescription("Exibe o painel principal."),
    new SlashCommandBuilder().setName("meta").setDescription("Mostra sua meta semanal."),
    new SlashCommandBuilder().setName("ranking").setDescription("Mostra o ranking semanal."),
    new SlashCommandBuilder().setName("depositar").setDescription("Depositar farm + print obrigatório."),
    new SlashCommandBuilder().setName("config").setDescription("Painel administrativo (apenas admins)."),
    new SlashCommandBuilder().setName("ajuda").setDescription("Mostra todos os comandos e explicações."),
  ].map(cmd => cmd.toJSON());

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("[BOT] 🧩 Comandos registrados com sucesso.");
  } catch (err) {
    console.error("[BOT] ❌ Falha ao registrar comandos:", err);
  }

  // Crons automáticos
  cron.schedule(config.cron.rankingSemanal, enviarRankingSemanal, { timezone: "America/Sao_Paulo" });
  cron.schedule(config.cron.resetSemanal, enviarRelatorioEMeta, { timezone: "America/Sao_Paulo" });
  console.log("[BOT] 🕒 Tarefas automáticas semanais agendadas.");
});

// ====== Interações ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild, channel } = interaction;
  const reply = (content, ephemeral = true) => interaction.reply({ content, ephemeral });

  switch (commandName) {
    case "ajuda":
      const embedAjuda = new EmbedBuilder()
        .setTitle("📘 Central de Ajuda — Sistema de Metas da Facção")
        .setDescription("Comandos disponíveis:")
        .addFields(
          { name: "👤 Usuário", value: "`/painel`, `/depositar`, `/meta`, `/ranking`" },
          { name: "🛠 Admin", value: "`/config` — Gerenciar metas, cores e canais." }
        )
        .setColor(config.cores.painel)
        .setFooter({ text: "Bot Facção Pro — Sempre ativo 24h via Render" });
      return interaction.reply({ embeds: [embedAjuda], ephemeral: true });

    case "painel":
      const embedPainel = new EmbedBuilder()
        .setTitle("🎯 Painel de Metas da Facção")
        .setDescription("Escolha uma opção abaixo:")
        .setColor(config.cores.painel);

      const rowPainel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("criar_sala").setLabel("Criar Sala Privada").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("abrir_ajuda").setLabel("📘 Ver Comandos").setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embedPainel], components: [rowPainel], ephemeral: true });

    case "meta":
      const cargo = member.roles.cache.find(r => config.metas[r.name]);
      const meta = cargo ? config.metas[cargo.name] : 1500;
      db.get("SELECT * FROM metas WHERE user = ?", [member.id], (err, row) => {
        if (!row) return reply(`📊 Você ainda não começou sua meta! Faltam **${meta}**.`);
        const falta = Math.max(0, meta - row.quantidade);
        reply(`📅 Meta semanal:\n- Cargo: ${cargo?.name || "Membro"}\n- Farmado: **${row.quantidade}**\n- Falta: **${falta}**`);
      });
      break;

    case "ranking":
      enviarRanking(interaction.channel);
      return reply("🏆 Ranking enviado no canal!");
  }
});

// ====== Funções auxiliares ======
function enviarRanking(channel = null) {
  db.all("SELECT * FROM metas ORDER BY quantidade DESC", [], (err, rows) => {
    if (!rows?.length) return channel?.send("Ainda não há depósitos.");
    const lista = rows.map((r, i) => `${i + 1}. <@${r.user}> — **${r.quantidade}**\n📸 [Print](${r.imagem})`).join("\n\n");
    const embed = new EmbedBuilder()
      .setTitle("🏆 Ranking Semanal")
      .setDescription(lista)
      .setColor(config.cores.ranking);
    const canal = channel || client.channels.cache.get(config.canais.ranking);
    canal?.send({ embeds: [embed] });
  });
}

function enviarRankingSemanal() {
  console.log("[CRON] 📤 Enviando ranking semanal automático...");
  enviarRanking();
}

function enviarRelatorioEMeta() {
  db.all("SELECT * FROM metas", [], (err, rows) => {
    const canal = client.channels.cache.get(config.canais.resultado);
    if (!canal) return console.log("[CRON] ❌ Canal de resultados não encontrado.");
    const ok = [], fail = [];
    rows.forEach(r => {
      const membro = client.guilds.cache.first()?.members.cache.get(r.user);
      if (!membro) return;
      const cargo = membro.roles.cache.find(role => config.metas[role.name]);
      const meta = cargo ? config.metas[cargo.name] : 1500;
      (r.quantidade >= meta ? ok : fail).push(`<@${r.user}> (${r.quantidade}/${meta})`);
    });
    const embed = new EmbedBuilder()
      .setTitle("📊 Relatório Semanal")
      .setDescription(`✅ **Bateram:**\n${ok.join("\n") || "Ninguém"}\n\n❌ **Não bateram:**\n${fail.join("\n") || "Ninguém"}`)
      .setColor(config.cores.relatorio);
    canal.send({ embeds: [embed] });
    db.run("DELETE FROM metas");
    console.log("[CRON] 🔄 Metas resetadas.");
  });
}

client.login(process.env.DISCORD_TOKEN);
