import { redirect } from "next/navigation";

export default function HomePage() {
  redirect(process.env.NEXT_PUBLIC_STOREFRONT_ROOT === "true" ? "/tienda" : "/app");
}
