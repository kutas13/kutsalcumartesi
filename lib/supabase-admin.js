import { createClient } from '@supabase/supabase-js';
import { defaultState } from './default-state.js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key) console.warn('Supabase env variables are missing.');
export const supabaseAdmin=createClient(url||'http://localhost',key||'missing',{auth:{persistSession:false,autoRefreshToken:false}});
const BUCKET='kck-private';

async function ensureBucket(){
  const {data,error}=await supabaseAdmin.storage.getBucket(BUCKET);
  if(data&&!error)return;
  const created=await supabaseAdmin.storage.createBucket(BUCKET,{public:false,fileSizeLimit:1024*1024});
  if(created.error && !String(created.error.message||'').toLowerCase().includes('already')) throw created.error;
}
export async function readJson(path,fallback){
  await ensureBucket();
  const {data,error}=await supabaseAdmin.storage.from(BUCKET).download(path);
  if(error){
    if(fallback!==undefined){await writeJson(path,fallback);return structuredClone(fallback)}
    throw error;
  }
  return JSON.parse(await data.text());
}
export async function writeJson(path,value){
  await ensureBucket();
  const body=JSON.stringify(value,null,2);
  const {error}=await supabaseAdmin.storage.from(BUCKET).upload(path,new Blob([body],{type:'application/json'}),{upsert:true,contentType:'application/json',cacheControl:'0'});
  if(error)throw error;
}
export async function readState(){return readJson('state.json',defaultState())}
export async function writeState(state){state.updatedAt=new Date().toISOString();await writeJson('state.json',state);return state}
export async function readPasskeys(){return readJson('passkeys.json',{})}
export async function writePasskeys(data){return writeJson('passkeys.json',data)}
