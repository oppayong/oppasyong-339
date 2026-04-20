import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 保護機制：確保這是 Vercel Cron 觸發的，或是我們手動測試用的
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI';
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = 'WHDTIJsWkLiawh3goUk5p1GX1PHrNDzCx1BX+yuSaUIM0DUZal8NN5YWDoNkAapgBWen96t3HrifG9sNJhyn77o/Vuz3iWXOcg8h5+0sqj8vuQ8zbHRJyTfU+AfJAbniQWwXnJg68JA1U7CK/UgHvgdB04t89/1O/w1cDnyilFU=';

  try {
    // 1. 計算「剛好是 10 天前」的日期
    const today = new Date();
    const tenDaysAgoDate = new Date(today);
    tenDaysAgoDate.setDate(today.getDate() - 10);
    const targetDateStr = tenDaysAgoDate.toISOString().split('T')[0]; // 格式: YYYY-MM-DD

    // 2. 抓出 10 天前的所有「談建議書」和「增員面談」
    const { data: targetActivities, error } = await supabase
      .from('team_activities')
      .select('*')
      .eq('activity_date', targetDateStr)
      .in('activity_type', ['談建議書', '增員面談']);

    if (error || !targetActivities || targetActivities.length === 0) {
      return res.status(200).send(`日期 ${targetDateStr} 沒有需要追蹤的建議書或增員面談。`);
    }

    // 3. 抓取所有用戶的 LINE ID
    const { data: users } = await supabase.from('team_users').select('emp_id, line_user_id, name');
    const userMap = {};
    users.forEach(u => userMap[u.emp_id] = u);

    let pushCount = 0;

    // 4. 開始巡邏與判斷邏輯
    for (const act of targetActivities) {
      const user = userMap[act.emp_id];
      if (!user || !user.line_user_id) continue; // 如果該業務員沒綁定 LINE，就跳過

      let lineMessages = [];

      // 🔴 邏輯 A：談建議書追蹤
      if (act.activity_type === '談建議書') {
        // 檢查這 10 天內，這個業務員有沒有對這個客戶「簽約」
        const { data: signedCheck } = await supabase
          .from('team_activities')
          .select('id')
          .eq('emp_id', act.emp_id)
          .eq('client_name', act.client_name)
          .eq('activity_type', '簽約')
          .gte('activity_date', targetDateStr) // 大於等於 10 天前
          .limit(1);

        // 如果沒有簽約紀錄，發送提醒
        if (!signedCheck || signedCheck.length === 0) {
          lineMessages.push({
            type: 'text',
            text: `📊 【銷售追蹤提醒】\n\n${user.name} 您好，\n您於 10 天前向客戶「${act.client_name}」談過建議書。\n\n系統目前尚未偵測到簽約紀錄，請記得主動關心回訪，把握黃金促約期喔！💪`
          });
        }
      }

      // 🔵 邏輯 B：增員面談追蹤 (使用 LINE 的互動按鈕選單)
      if (act.activity_type === '增員面談') {
        lineMessages.push({
          type: "template",
          altText: `增員追蹤提醒：關於 ${act.client_name}`,
          template: {
            type: "buttons",
            title: "🤝 增員追蹤提醒",
            text: `您於 10 天前與「${act.client_name}」進行過增員面談，請問目前進度為何？`,
            actions: [
              { type: "message", label: "✅ 已增加臨時帳號", text: `更新進度：${act.client_name} 已增加臨時帳號` },
              { type: "message", label: "❌ 確認不增加", text: `更新進度：${act.client_name} 確認不增加` },
              { type: "message", label: "🔄 繼續追蹤", text: `更新進度：${act.client_name} 需要繼續追蹤` }
            ]
          }
        });
      }

      // 發送 LINE 推播
      if (lineMessages.length > 0) {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` },
          body: JSON.stringify({ to: user.line_user_id, messages: lineMessages })
        });
        pushCount++;
      }
    }

    res.status(200).send(`✅ 自動巡邏完成！共發送了 ${pushCount} 則追蹤提醒。`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Cron Job 執行失敗');
  }
}
