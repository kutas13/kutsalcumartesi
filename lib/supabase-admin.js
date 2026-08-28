import { createClient } from '@supabase/supabase-js';
import { defaultState } from './default-state.js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) console.warn('Supabase env variables are missing.');

export const supabaseAdmin=createClient(url||'http://localhost',key||'missing',{
  auth:{persistSession:false,autoRefreshToken:false}
});

export async function readState(){
  const {data,error}=await supabaseAdmin.rpc('kck_read_state');
  if(error){
    if(String(error.message||'').includes('kck_read_state')){
      return defaultState();
    }
    throw error;
  }
  const state=data||defaultState();
  return {...defaultState(),...state,version:7};
}

export async function writeState(state){
  const clean={...state,version:7,updatedAt:new Date().toISOString()};
  const {data,error}=await supabaseAdmin.rpc('kck_replace_state',{p_state:clean});
  if(error) throw error;
  return {...defaultState(),...(data||clean),version:7};
}

export async function credentialsForUser(user){
  const {data,error}=await supabaseAdmin
    .from('kck_passkeys')
    .select('*')
    .eq('user_name',user)
    .order('created_at',{ascending:true});
  if(error) throw error;
  return (data||[]).map(row=>({
    id:row.credential_id,
    publicKey:row.public_key,
    counter:Number(row.counter||0),
    transports:Array.isArray(row.transports)?row.transports:[],
    deviceType:row.device_type||null,
    backedUp:!!row.backed_up,
    createdAt:row.created_at,
    ...(row.payload||{})
  }));
}

export async function upsertCredential(user,cred){
  const row={
    credential_id:cred.id,
    user_name:user,
    public_key:cred.publicKey,
    counter:Number(cred.counter||0),
    transports:cred.transports||[],
    device_type:cred.deviceType||null,
    backed_up:!!cred.backedUp,
    created_at:cred.createdAt||new Date().toISOString(),
    payload:cred
  };
  const {error}=await supabaseAdmin
    .from('kck_passkeys')
    .upsert(row,{onConflict:'credential_id'});
  if(error) throw error;
}

export async function markNotificationsRead(user){
  const {data,error}=await supabaseAdmin
    .from('kck_notifications')
    .select('id,payload')
    .eq('target_user',user)
    .eq('is_read',false);
  if(error) throw error;
  if(!data?.length)return;
  for(const row of data){
    const payload={...(row.payload||{}),read:true};
    const {error:updateError}=await supabaseAdmin
      .from('kck_notifications')
      .update({is_read:true,payload})
      .eq('id',row.id);
    if(updateError) throw updateError;
  }
}
