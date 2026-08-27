import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import crypto from 'crypto';

const COOKIE='kck_session';
const secret=new TextEncoder().encode(process.env.SESSION_SECRET||'development-only-change-me-please-123456');
export const userConfig={
  Yusuf:{role:'admin',password:process.env.KCK_YUSUF_PASSWORD||'2807'},
  'Ömer':{role:'viewer',password:process.env.KCK_OMER_PASSWORD||'8080'},
  Taha:{role:'viewer',password:process.env.KCK_TAHA_PASSWORD||'1313'}
};
function safeEq(a,b){const A=Buffer.from(String(a)),B=Buffer.from(String(b));return A.length===B.length&&crypto.timingSafeEqual(A,B)}
export function verifyPassword(user,password){return !!userConfig[user]&&safeEq(userConfig[user].password,password)}
export async function makeSession(user){return new SignJWT({role:userConfig[user].role}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuedAt().setExpirationTime('7d').sign(secret)}
export async function setSession(user){const c=await cookies();c.set(COOKIE,await makeSession(user),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:60*60*24*7})}
export async function clearSession(){const c=await cookies();c.set(COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0})}
export async function getSession(){try{const c=await cookies();const token=c.get(COOKIE)?.value;if(!token)return null;const {payload}=await jwtVerify(token,secret);const user=payload.sub;if(!userConfig[user])return null;return {user,role:userConfig[user].role}}catch{return null}}
export async function requireSession(){const s=await getSession();if(!s)throw new Error('UNAUTHORIZED');return s}
