import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('鎔安組 LINE Bot 正常運作中！');
  }

  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = 'WHDTIJsWkLiawh3goUk5p1GX1PHrNDzCx1BX+yuSaUIM0DUZal8NN5YWDoNkAapgBWen96t3HrifG9sNJhyn77o/Vuz3iWXOcg8h5+0sqj8vuQ8zbHRJyTfU+AfJAbniQWwXnJg68JA1U7CK/UgHvgdB04t89/1O/w1cDnyilFU=';

  try {
    const events = req.body.events;
    if (!events || events.length === 0) return res.status(200).send('OK');

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();
        const lineUserId = event.source.userId;
        let replyText = '';

        if (userMessage.startsWith('綁定')) {
          // 以空格拆分文字，預期格式：綁定 員編 密碼
          const parts = userMessage.split(/\s+/);
          
          if (parts.length < 3) {
            replyText = `⚠️ 格式錯誤！\n基於資安防護，綁定時需驗證您的密碼。\n請輸入：「綁定 您的員編 您的密碼」\n（中間請用空格隔開）`;
          } else {
            const empId = parts[1];
            const password = parts[2];
            
            const { data: user } = await supabase.from('team_users').select('*').eq('emp_id', empId).single();
            
            if (!user) {
              replyText = `❌ 找不到此員編。請確認輸入是否正確。`;
            } else if (user.password !== password) {
              replyText = `❌ 密碼錯誤！請確認您輸入的密碼是否正確，以保護客戶資料安全。`;
            } else if (user.password === '000000') {
              replyText = `🔒 【資安阻擋】\n您目前使用的是「預設密碼(000000)」。\n為了保護客戶名單不被盜用，請先至 339 戰情室網頁版「修改個人密碼」後，再回 LINE 進行綁定！`;
            } else {
              await supabase.from('team_users').update({ line_user_id: lineUserId }).eq('emp_id', empId);
              replyText = `🎉 綁定成功！歡迎回來，${user.name} ${user.role === 'admin' ? '主管' : '夥伴'}。\n未來的行程與追蹤提醒將會發送到這裡。`;
            }
          }
        } 
        else if (userMessage.startsWith('更新進度：')) {
          replyText = `✅ 收到！已為您記錄此進度。鎔安組系統會持續與您一起追蹤！💪`;
        }
        else {
          replyText = '您好！我是鎔安組戰情管家。\n若尚未綁定，請輸入：「綁定 您的員編 您的密碼」（中間需有空格）來啟用自動化提醒服務。';
        }

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
