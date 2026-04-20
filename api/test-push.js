import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

  try {
    const { data: users, error } = await supabase
      .from('team_users')
      .select('name, line_user_id')
      .not('line_user_id', 'is', null);

    if (error || !users || users.length === 0) return res.status(200).send('目前沒有人綁定 LINE。');

    let successCount = 0;
    for (const user of users) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` },
        body: JSON.stringify({
          to: user.line_user_id,
          messages: [{ type: 'text', text: `🔔 【鎔安組戰情中心 - 系統廣播】\n\n${user.name} 您好！\n您的 LINE 綁定與推播接收功能運作完全正常！🚀` }]
        })
      });
      successCount++;
    }
    res.status(200).send(`✅ 推播測試成功！已發送給 ${successCount} 位夥伴。`);
  } catch (error) { res.status(500).send('伺服器錯誤'); }
}
