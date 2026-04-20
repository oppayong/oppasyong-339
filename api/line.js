import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 處理 LINE Webhook 的驗證請求
  if (req.method === 'GET') {
    return res.status(200).send('鎔安組 LINE Bot 正常運作中！');
  }

  // 你的專屬金鑰
  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  const LINE_ACCESS_TOKEN = 'WHDTIJsWkLiawh3goUk5p1GX1PHrNDzCx1BX+yuSaUIM0DUZal8NN5YWDoNkAapgBWen96t3HrifG9sNJhyn77o/Vuz3iWXOcg8h5+0sqj8vuQ8zbHRJyTfU+AfJAbniQWwXnJg68JA1U7CK/UgHvgdB04t89/1O/w1cDnyilFU=';

  try {
    const events = req.body.events;
    if (!events || events.length === 0) return res.status(200).send('OK');

    for (const event of events) {
      // 當有人傳送文字訊息給機器人
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();
        const lineUserId = event.source.userId;
        let replyText = '';

        // 綁定帳號邏輯
        if (userMessage.startsWith('綁定')) {
          const empId = userMessage.replace('綁定', '').trim();
          
          // 去資料庫找有沒有這個員工
          const { data: user, error } = await supabase.from('team_users').select('*').eq('emp_id', empId).single();
          
          if (user) {
            // 更新 LINE ID
            await supabase.from('team_users').update({ line_user_id: lineUserId }).eq('emp_id', empId);
            replyText = `🎉 綁定成功！歡迎回來，${user.name} ${user.role === 'admin' ? '主管' : '夥伴'}。\n未來的行程與追蹤提醒將會發送到這裡。`;
          } else {
            replyText = `找不到員編：${empId}。請確認輸入格式為「綁定 員編」，或請區經理為您開通帳號。`;
          }
        } 
        else {
          replyText = '您好！我是鎔安組戰情管家。\n請輸入「綁定 您的員編」（例如：綁定 2000106583）來啟用自動化提醒服務。';
        }

        // 回傳訊息給使用者
        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: replyText }]
          })
        });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
}
