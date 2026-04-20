// 這個檔案負責將 Supabase 的資料轉換成 iPhone 行事曆訂閱格式 (.ics)

export default async function handler(req, res) {
  // ⚠️ 請替換成你的鑰匙！
  const SUPABASE_URL = 'https://mezculqrqxwlmfxgrcru.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lemN1bHFycXh3bG1meGdyY3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjU0NjUsImV4cCI6MjA5MjI0MTQ2NX0.U8aAJs5wi2_wPNWeNRrucQH7gPH4rEJx9KfTgHljVZI
';

  try {
    // 從 Supabase 抓取所有活動紀錄 (使用最單純的 fetch，速度最快)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/activities?select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    const activities = await response.json();

    // 建立 iCalendar 格式標頭
    let icsString = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//RongAn//339WarRoom//TW\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:南山 339 戰情\r\nX-WR-TIMEZONE:Asia/Taipei\r\n`;

    // 將每一筆活動轉換成日曆事件
    activities.forEach(act => {
      // 處理日期與時間格式 (移除連接號與冒號)
      const dateStr = act.activity_date.replace(/-/g, '');
      const startStr = act.start_time.replace(':', '') + '00';
      const endStr = act.end_time.replace(':', '') + '00';
      
      const dtStart = `${dateStr}T${startStr}`;
      const dtEnd = `${dateStr}T${endStr}`;
      
      // 事件標題：例如 "[約訪] 王董"
      const summary = `[${act.activity_type}] ${act.client_name}`;
      const description = act.notes ? act.notes : '無備註';

      icsString += `BEGIN:VEVENT\r\n`;
      icsString += `UID:${act.id}@rongan339.com\r\n`;
      icsString += `DTSTAMP:${dtStart}Z\r\n`;
      icsString += `DTSTART;TZID=Asia/Taipei:${dtStart}\r\n`;
      icsString += `DTEND;TZID=Asia/Taipei:${dtEnd}\r\n`;
      icsString += `SUMMARY:${summary}\r\n`;
      icsString += `DESCRIPTION:${description}\r\n`;
      icsString += `END:VEVENT\r\n`;
    });

    icsString += `END:VCALENDAR`;

    // 告訴瀏覽器/手機，這是一個日曆檔案
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // 讓檔案可以被下載或訂閱
    res.setHeader('Content-Disposition', 'attachment; filename="rongan-339.ics"');
    
    // 輸出
    res.status(200).send(icsString);

  } catch (error) {
    res.status(500).json({ error: '日曆生成失敗' });
  }
}
