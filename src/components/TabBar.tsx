"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SunIcon, KettlebellIcon, PlateIcon, TrendIcon, ChatIcon } from "./icons";

const tabs = [
  { href: "/", label: "Today", Icon: SunIcon },
  { href: "/train", label: "Train", Icon: KettlebellIcon },
  { href: "/eat", label: "Eat", Icon: PlateIcon },
  { href: "/progress", label: "Progress", Icon: TrendIcon },
  { href: "/coach", label: "Coach", Icon: ChatIcon },
];

export default function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-bg/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md grid grid-cols-5">
        {tabs.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold tracking-wide transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon size={21} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
