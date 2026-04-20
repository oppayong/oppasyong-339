import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 資料庫金鑰
  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // LINE 金鑰
  const LINE_ACCESS_TOKEN = 'WHDTIJsWkLiawh3goUk5p1GX1PHrNDzCx1BX+yuSaUIM0DUZal8NN5YWDoNkAapgBWen96t3HrifG9sNJhyn77o/Vuz3iWXOcg8h5+0sqj8vuQ8zbHRJyTfU+AfJAbniQWwXnJg68JA1U7CK/UgHvgdB04t89/1O/w1cDnyilFU=';

  try {
    // 1. 從資料庫抓出「所有已經綁定 LINE ID」的團隊成員
    const { data: users, error } = await supabase
      .from('team_users')
      .select('name, line_user_id')
      .not('line_user_id', 'is', null);

    if (error || !users || users.length === 0) {
      return res.status(200).send('目前資料庫中沒有任何人成功綁定 LINE 帳號。');
    }

    let successCount = 0;

    // 2. 針對這些人，由伺服器主動發送 LINE 訊息 (Push Message)
    for (const user of users) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          to: user.line_user_id, // 發送給這個特定的 LINE ID
          messages: [{ 
            type: 'text', 
            text: `🔔 【鎔安組戰情中心 - 系統廣播】\n\n${user.name} 您好！\n您的 LINE 綁定與推播接收功能運作完全正常！🚀\n\n(此為手動觸發之測試訊息)` 
          }]
        })
      });
      successCount++;
    }

    res.status(200).send(`✅ 推播測試成功！已發送 LINE 訊息給 ${successCount} 位團隊夥伴。請檢查手機！`);
  } catch (error) {
    console.error(error);
    res.status(500).send('伺服器發生錯誤');
  }
}
