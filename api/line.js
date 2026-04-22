import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('鎔安組 LINE Bot 正常運作中！');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

  try {
    const events = req.body.events;
    if (!events || events.length === 0) return res.status(200).send('OK');

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text.trim();
        const lineUserId = event.source.userId;
        let replyText = '';

        if (userMessage.startsWith('綁定')) {
          const parts = userMessage.split(/\s+/);
          if (parts.length < 3) {
            replyText = `⚠️ 格式錯誤！\n請輸入：「綁定 您的員編 您的密碼」\n（中間請用空格隔開）`;
          } else {
            const empId = parts[1];
            const password = parts[2];
            const { data: user } = await supabase.from('team_users').select('*').eq('emp_id', empId).single();
            if (!user) {
              replyText = `❌ 找不到此員編。`;
            } else if (user.password !== password) {
              replyText = `❌ 密碼錯誤！`;
            } else if (user.password === '000000') {
              replyText = `🔒 【資安阻擋】\n您使用的是預設密碼，請先至網頁版修改密碼後再綁定！`;
            } else {
              await supabase.from('team_users').update({ line_user_id: lineUserId }).eq('emp_id', empId);
              replyText = `🎉 綁定成功！歡迎回來，${user.name} ${user.role === 'admin' ? '主管' : '夥伴'}。`;
            }
          }
        } 
        else if (userMessage.startsWith('更新進度：')) {
          // 🎯 擷取按鈕回傳的狀態，並寫入資料庫
          const match = userMessage.match(/^更新進度：(.*?) (已增加臨時帳號|確認不增加|需要繼續追蹤)$/);
          
          if (match) {
            const clientName = match[1].trim();
            const status = match[2];
            
            // 查出這個 LINE ID 是誰的
            const { data: userRecord } = await supabase.from('team_users').select('emp_id').eq('line_user_id', lineUserId).single();
            
            if (userRecord) {
              const now = new Date();
              const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
              const todayStr = taipeiTime.toISOString().split('T')[0];
              const timeStr = taipeiTime.toISOString().split('T')[1].substring(0, 5);
              
              // 在資料庫留下一筆「增員追蹤」紀錄
              await supabase.from('team_activities').insert({
                emp_id: userRecord.emp_id,
                activity_date: todayStr,
                start_time: timeStr,
                activity_type: '增員追蹤',
                client_name: clientName,
                notes: status,
                sales_score: 0,
                recruit_score: 0
              });
            }
            
            replyText = `✅ 已為您記錄「${clientName}」的進度為：${status}！`;
            if (status === '需要繼續追蹤') {
               replyText += `\n系統將在30天內持續為您溫馨提醒。💪`;
            } else {
               replyText += `\n此名單已結案，不再跳出每日提醒。🎉`;
            }
          } else {
            replyText = `✅ 收到！已為您記錄此進度。`;
          }
        }
        else {
          replyText = '您好！我是鎔安組戰情管家。\n若尚未綁定，請輸入：「綁定 您的員編 您的密碼」。';
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
