const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const webAppBaseUrl = 'https://www.mfuture.com.br/lucremais/task.html';

bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const fullUrl = `${webAppBaseUrl}?id=${userId}`;

  bot.sendMessage(msg.chat.id, '📋 Acesse suas tarefas abaixo:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '📋 Abrir Tarefas',
          web_app: { url: fullUrl }
        }
      ]]
    }
  });
});
