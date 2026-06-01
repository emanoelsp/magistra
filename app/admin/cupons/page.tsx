import { getAdminDb } from "../../../lib/firebase/admin";
import type { CouponRecord } from "../../../lib/types/firestore";
import { CuponManager } from "./cupon-manager";

async function getCupons(): Promise<CouponRecord[]> {
  const db = getAdminDb();
  const snap = await db.collection("magis_cupons").orderBy("created_at", "desc").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CouponRecord[];
}

export default async function CuponsPage() {
  const cupons = await getCupons();
  return <CuponManager initial={cupons} />;
}
