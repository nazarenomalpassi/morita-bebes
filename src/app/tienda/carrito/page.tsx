import type { Metadata } from "next";

import { StoreCart } from "@/components/store/store-cart";
import { getStoreContext } from "@/lib/store/queries";
import { RETAIL_MINIMUM_DEFAULT, WHOLESALE_MINIMUM_DEFAULT } from "@/lib/store/types";

export const metadata: Metadata = { title: "Carrito", robots: { index: false, follow: false } };

export default async function StoreCartPage() {
  const context = await getStoreContext();
  const minimum = context.accountType === "wholesale"
    ? Number(context.settings.minimum_wholesale_amount ?? WHOLESALE_MINIMUM_DEFAULT)
    : Number(context.settings.minimum_retail_amount ?? RETAIL_MINIMUM_DEFAULT);
  return <StoreCart accountType={context.accountType} authenticated={Boolean(context.profile)} minimum={minimum} />;
}
