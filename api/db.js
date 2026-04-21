import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 🔥 終極殺手鐧：強制所有手機瀏覽器不准快取，確保永遠拿到最新資料！
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { action, credentials, payload } = req.body;
  if (!credentials || !credentials.empId || !credentials.password) {
    return res.status(401).json({ error: '缺少驗證憑證' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: user, error: authErr } = await supabase
    .from('team_users')
    .select('*')
    .eq('emp_id', credentials.empId)
    .eq('password', credentials.password)
    .single();

  if (authErr || !user) return res.status(401).json({ error: '帳號或密碼錯誤' });
  if (user.is_active === false) return res.status(403).json({ error: '帳號已被停權' });

  try {
    switch (action) {
      case 'login':
        return res.status(200).json(user);

      case 'get_team':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        const { data: team } = await supabase.from('team_users').select('emp_id, name, is_active, role');
        return res.status(200).json(team);

      case 'update_password':
        await supabase.from('team_users').update({ password: payload.newPassword }).eq('emp_id', user.emp_id);
        return res.status(200).json({ ok: true });

      case 'load_activities':
        let q = supabase.from('team_activities').select('*');
        if (payload.viewingEmpId !== 'ALL') {
          const targetId = user.role === 'admin' ? payload.viewingEmpId : user.emp_id;
          q = q.eq('emp_id', targetId);
        } else {
          if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        }
        const { data: acts } = await q;
        return res.status(200).json(acts);

      case 'load_org':
        // 🔥 終極修正：強制抓取絕對唯一 ID，解決舊版本重複產生的問題
        const { data: orgData } = await supabase.from('activities').select('notes').eq('id', '00000000-0000-0000-0000-000000000001').single();
        return res.status(200).json(orgData ? [orgData] : []);

      case 'save_org':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        await supabase.from('activities').upsert({ id: '00000000-0000-0000-0000-000000000001', activity_date: '2099-12-31', start_time: '00:00', activity_type: 'VAULT', client_name: 'APP_VAULT_V1', notes: payload.notes });
        return res.status(200).json({ ok: true });

      case 'save_activity':
        const targetSaveId = user.role === 'admin' ? payload.activityPayload.emp_id : user.emp_id;
        payload.activityPayload.emp_id = targetSaveId;
        await supabase.from('team_activities').upsert(payload.activityPayload);
        return res.status(200).json({ ok: true });

      case 'delete_activity':
        let delQ = supabase.from('team_activities').delete().eq('id', payload.id);
        if (user.role !== 'admin') delQ = delQ.eq('emp_id', user.emp_id);
        await delQ;
        return res.status(200).json({ ok: true });

      case 'create_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        await supabase.from('team_users').insert({ emp_id: payload.empId, password: payload.password, name: payload.name, role: 'agent' });
        return res.status(200).json({ ok: true });

      case 'update_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        await supabase.from('team_users').update(payload.updateData).eq('emp_id', payload.empId);
        return res.status(200).json({ ok: true });

      case 'delete_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        await supabase.from('team_activities').delete().eq('emp_id', payload.empId);
        await supabase.from('team_users').delete().eq('emp_id', payload.empId);
        return res.status(200).json({ ok: true });

      default:
        return res.status(400).json({ error: 'Invalid Action' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
