import { NextResponse } from 'next/server';import { getSession } from '../../../../lib/auth.js';
export async function GET(){const s=await getSession();return s?NextResponse.json({authenticated:true,...s}):NextResponse.json({authenticated:false},{status:401})}
