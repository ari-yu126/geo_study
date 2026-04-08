import { NextResponse } from 'next/server';
import { loadActiveScoringConfig } from '@/lib/scoringConfigLoader';

export async function GET() {
  try {
    const config = await loadActiveScoringConfig();
    return NextResponse.json({ config }, { status: 200 });
  } catch (err: unknown) {
    console.error('geo-config GET error:', err);
    return NextResponse.json(
      { error: '설정 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
