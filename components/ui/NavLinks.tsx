"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStyles } from "./ThemeProvider";

/** The page links in the top bar. The current page is marked with aria-current. */
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const { nav } = useStyles();
  return (
    <nav aria-label="Primary" className={nav.list}>
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(nav.link, active && nav.active)}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
