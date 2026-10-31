import type { DisplayMode, OverlayRow } from '@/types';

/** Sample dialogue for demo mode. Shown only on request and always labeled as demo data. */
export const DEMO_LINES: Array<{ ja: string; th: string }> = [
  { ja: 'おはよう、今日はずいぶん早いね。', th: 'อรุณสวัสดิ์ วันนี้มาเช้าจังเลยนะ' },
  { ja: 'うん、昨日の夜あんまり眠れなくて。', th: 'อืม เมื่อคืนนอนไม่ค่อยหลับน่ะ' },
  { ja: 'コーヒー淹れようか？', th: 'ชงกาแฟให้ไหม' },
  { ja: 'ありがとう。ミルクも入れてくれる？', th: 'ขอบคุณนะ ใส่นมให้ด้วยได้ไหม' },
  { ja: 'いいよ。じゃあ、今日の予定を確認しよう。', th: 'ได้เลย งั้นมาเช็กตารางของวันนี้กันเถอะ' },
  { ja: '午後から雨になるらしいから、傘を忘れないでね。', th: 'ได้ยินว่าบ่ายนี้ฝนจะตก อย่าลืมเอาร่มไปด้วยนะ' },
];

const SAMPLE = [
  { ja: '今日はいい天気ですね。', th: 'วันนี้อากาศดีจังเลยนะ' },
  { ja: 'それでは、次の話題に移りましょう。', th: 'ถ้าอย่างนั้น เราไปหัวข้อถัดไปกันเลย' },
];

/** Two finished lines used only for styling previews. They are labeled as samples wherever they appear. */
export function makeSampleRows(mode: DisplayMode): OverlayRow[] {
  return SAMPLE.map((l, i) => ({
    id: `sample-${i}`,
    ja: l.ja,
    th: l.th,
    stable: l.ja.length,
    status: 'final' as const,
    leaving: false,
    showJa: mode !== 'thai',
    showTh: mode !== 'japanese',
  }));
}
