import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 強制破壞所有手機與電腦的快取，確保拿到最新資料
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

  // 1. 身分驗證
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

      // 🔥 組織圖讀取：不再死板對應 ID，直接抓取最新的 APP_VAULT_V1
      case 'load_org':
        const { data: orgList, error: loadErr } = await supabase
          .from('activities')
          .select('notes')
          .eq('client_name', 'APP_VAULT_V1')
          .limit(1);
          
        if (loadErr) throw new Error(loadErr.message);
        return res.status(200).json(orgList && orgList.length > 0 ? orgList[0] : null);

      // 🔥 組織圖儲存：徹底放棄會引發衝突的 UPSERT，改用 UPDATE 強制覆蓋幽靈草稿！
      case 'save_org':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        
        const { data: updatedRows, error: updateErr } = await supabase
          .from('activities')
          .update({ notes: payload.notes })
          .eq('client_name', 'APP_VAULT_V1')
          .select();
          
        if (updateErr) throw new Error('更新組織圖失敗: ' + updateErr.message);
        
        // 防呆機制：如果原本資料庫完全沒資料，才執行全新建立
        if (!updatedRows || updatedRows.length === 0) {
           const { error: insertErr } = await supabase.from('activities').insert({
              activity_date: '2099-12-31', 
              start_time: '00:00', 
              activity_type: 'VAULT', 
              client_name: 'APP_VAULT_V1', 
              notes: payload.notes
           });
           if (insertErr) throw new Error('建立組織圖失敗: ' + insertErr.message);
        }
        
        return res.status(200).json({ ok: true });

      case 'save_activity':
        const targetSaveId = user.role === 'admin' ? payload.activityPayload.emp_id : user.emp_id;
        payload.activityPayload.emp_id = targetSaveId;
        const { error: saveActErr } = await supabase.from('team_activities').upsert(payload.activityPayload);
        if (saveActErr) throw new Error(saveActErr.message);
        return res.status(200).json({ ok: true });

      case 'delete_activity':
        let delQ = supabase.from('team_activities').delete().eq('id', payload.id);
        if (user.role !== 'admin') delQ = delQ.eq('emp_id', user.emp_id);
        const { error: delErr } = await delQ;
        if (delErr) throw new Error(delErr.message);
        return res.status(200).json({ ok: true });

      case 'create_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        const { error: createUserErr } = await supabase.from('team_users').insert({ emp_id: payload.empId, password: payload.password, name: payload.name, role: 'agent' });
        if (createUserErr) throw new Error(createUserErr.message);
        return res.status(200).json({ ok: true });

      case 'update_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        const { error: updateUserErr } = await supabase.from('team_users').update(payload.updateData).eq('emp_id', payload.empId);
        if (updateUserErr) throw new Error(updateUserErr.message);
        return res.status(200).json({ ok: true });

      case 'delete_user':
        if (user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        await supabase.from('team_activities').delete().eq('emp_id', payload.empId);
        const { error: delUserErr } = await supabase.from('team_users').delete().eq('emp_id', payload.empId);
        if (delUserErr) throw new Error(delUserErr.message);
        return res.status(200).json({ ok: true });

      default:
        return res.status(400).json({ error: 'Invalid Action' });
    }
  } catch (e) {
    // 現在如果有任何錯誤，都會直接噴給前端的 Toast 顯示，再也不會被暗中吃掉！
    return res.status(500).json({ error: e.message });
  }
}
