import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function HomePage() {
  const session = await auth()

  if (session) {
    redirect("/feed")
  } else {
    redirect("/login")
  }
}
