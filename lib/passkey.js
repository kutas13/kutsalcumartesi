import { cookies, headers } from 'next/headers';
import { readPasskeys, writePasskeys } from './supabase-admin.js';
const CHALLENGE_COOKIE='kck_webauthn_challenge';
export async function rpConfig(){
  const h=await headers();const host=h.get('host')||'';
  const rpID=process.env.PASSKEY_RP_ID||host.split(':')[0]||'localhost';
  const origin=process.env.PASSKEY_ORIGIN||`${process.env.NODE_ENV==='production'?'https':'http'}://${host||'localhost:3000'}`;
  return {rpID,origin,rpName:'Kutsal Cumartesi Kasa'};
}
export async function setChallenge(challenge,user,purpose){const c=await cookies();c.set(CHALLENGE_COOKIE,JSON.stringify({challenge,user,purpose}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:300})}
export async function getChallenge(){try{const c=await cookies();return JSON.parse(c.get(CHALLENGE_COOKIE)?.value||'null')}catch{return null}}
export async function clearChallenge(){const c=await cookies();c.set(CHALLENGE_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0})}
export async function credentialsFor(user){const all=await readPasskeys();return Array.isArray(all[user])?all[user]:[]}
export async function saveCredential(user,cred){const all=await readPasskeys();all[user]=Array.isArray(all[user])?all[user]:[];const i=all[user].findIndex(x=>x.id===cred.id);if(i>=0)all[user][i]=cred;else all[user].push(cred);await writePasskeys(all)}
