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

  const base=defaultState();
  const state=data||base;
  const loadedAccounts=Array.isArray(state.accounts)?state.accounts:[];
  const coreIds=new Set(loadedAccounts.map(a=>a?.id));
  const missingCore=base.accounts.filter(a=>!coreIds.has(a.id));

  // Keep required system accounts available even on a fresh/partially seeded DB.
  if(missingCore.length){
    const seeded={
      ...base,
      ...state,
      accounts:[...loadedAccounts,...missingCore],
      transactions:Array.isArray(state.transactions)?state.transactions:[],
      debtPlans:Array.isArray(state.debtPlans)?state.debtPlans:[],
      paymentClaims:Array.isArray(state.paymentClaims)?state.paymentClaims:[],
      notifications:Array.isArray(state.notifications)?state.notifications:[],
      prices:{...base.prices,...(state.prices||{})},
      priceNames:{...base.priceNames,...(state.priceNames||{})},
      settings:{...base.settings,...(state.settings||{})},
      version:7
    };
    const {data:seededData,error:seedError}=await supabaseAdmin.rpc('kck_replace_state',{p_state:seeded});
    if(seedError) throw seedError;
    return {...seeded,...(seededData||{}),version:7};
  }

  return {
    ...base,
    ...state,
    accounts:loadedAccounts,
    transactions:Array.isArray(state.transactions)?state.transactions:[],
    debtPlans:Array.isArray(state.debtPlans)?state.debtPlans:[],
    paymentClaims:Array.isArray(state.paymentClaims)?state.paymentClaims:[],
    notifications:Array.isArray(state.notifications)?state.notifications:[],
    prices:{...base.prices,...(state.prices||{})},
    priceNames:{...base.priceNames,...(state.priceNames||{})},
    settings:{...base.settings,...(state.settings||{})},
    version:7
  };
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
