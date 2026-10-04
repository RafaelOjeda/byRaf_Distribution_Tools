import { authProxy } from "@/lib/auth";

export const proxy = authProxy;

export const config = {
  matcher: [
    // Every page and server action; skips Next internals and static files
    // (icons, the PWA manifest) so they load on the sign-in screen too.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
