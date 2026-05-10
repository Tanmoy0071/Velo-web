import { auth } from '@insforge/nextjs';
import { createClient } from '@insforge/sdk';


export async function getAuthServer() {
  const { token, user } = await auth()

  const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_BASE_URL || process.env.INSFORGE_BASE_URL || 'https://zr5sv6mr.us-east.insforge.app',
    anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY || 'ik_648f422cbf398b14195c014ebd84f8b4',
    edgeFunctionToken: token || undefined
  });

  return { insforge, user }

}
