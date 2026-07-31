'use client';

import { Menu, Plus, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/base/buttons/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/repos', label: 'Repositories' },
  { href: '/categories', label: 'Categories' },
  { href: '/contributors', label: 'Contributors' },
];

/**
 * Floating-pill header adapted from the kitti portfolio: a translucent,
 * blurred, rounded card fixed over the content, with a full-screen slide-down
 * menu on mobile. It is `fixed` rather than `sticky`, so the layout adds
 * top padding to <main> to clear it.
 *
 * A client component because the mobile menu holds open/closed state and the
 * nav highlights the current section via usePathname.
 */
export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  // Lock the background from scrolling while the overlay menu is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // Any navigation closes the menu — the target route has already rendered
  // underneath, so leaving it open would cover the page the user asked for.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 flex h-20 w-full items-center justify-center pt-3">
        <div className="flex size-full max-w-[100rem] flex-1 items-center px-3 md:px-6">
          <div
            className={cn(
              'flex w-full items-center justify-between gap-4 px-3 py-2 md:px-4 md:py-2.5',
              // Desktop: always the floating pill — a hair of card colour, a
              // thin ring and a soft shadow so it reads as floating above content.
              'md:rounded-2xl md:bg-primary/70 md:shadow-sm md:ring-1 md:ring-secondary md:backdrop-blur-xl',
              // Mobile: the pill only while the menu is CLOSED. Once it opens it
              // must blend into the full-screen overlay, so drop the background,
              // ring and rounding entirely.
              !mobileOpen &&
                'max-md:rounded-2xl max-md:bg-primary/70 max-md:shadow-sm max-md:ring-1 max-md:ring-secondary max-md:backdrop-blur-xl',
            )}
          >
            {/* Logo + wordmark, and the desktop nav sharing the flex-1 group so
                the actions on the right push to the edge. */}
            <div className="flex flex-1 items-center gap-5">
              <Link
                href="/"
                onClick={closeMobile}
                className="flex shrink-0 items-center gap-2.5 tracking-tight"
              >
                <Image
                  src="/logo.png"
                  alt=""
                  width={34}
                  height={34}
                  priority
                  className="size-[34px] shrink-0 rounded-lg"
                />
                <span className="text-[1.167rem] font-semibold leading-none">{env.siteName}</span>
              </Link>

              <nav aria-label="Primary" className="max-md:hidden">
                <ul className="flex items-center gap-0.5">
                  {NAV.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                            active
                              ? 'bg-secondary text-primary'
                              : 'text-tertiary hover:bg-secondary hover:text-primary',
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>

            {/* Actions: theme toggle on both; the CTA on desktop; the hamburger
                on mobile. */}
            <div className="flex items-center gap-1.5 md:gap-2">
              <ThemeToggle />

              <Button
                href="/submit"
                color="primary"
                size="md"
                iconLeading={Plus}
                className="max-md:hidden"
              >
                Submit a repo
              </Button>

              <button
                type="button"
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((open) => !open)}
                className="rounded-lg p-2 text-primary transition-colors hover:bg-secondary md:hidden"
              >
                {mobileOpen ? (
                  <X className="size-6" aria-hidden="true" />
                ) : (
                  <Menu className="size-6" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile full-screen menu. Always mounted so the open/close transitions
          run reliably; visibility + pointer-events gate interaction when shut. */}
      <div
        className="fixed inset-0 z-40 flex flex-col bg-primary/90 pt-20 backdrop-blur-xl md:hidden"
        style={{
          transition: `opacity ${mobileOpen ? 400 : 250}ms ease-out, transform ${
            mobileOpen ? 400 : 250
          }ms ease-out, visibility 0ms ${mobileOpen ? '0ms' : '250ms'}`,
          transform: mobileOpen ? 'translateY(0)' : 'translateY(-100%)',
          opacity: mobileOpen ? 1 : 0,
          visibility: mobileOpen ? 'visible' : 'hidden',
          pointerEvents: mobileOpen ? 'auto' : 'none',
        }}
      >
        <nav aria-label="Mobile" className="flex flex-1 flex-col">
          <ul className="flex flex-col gap-0.5 px-4 pt-6">
            {NAV.map((item, i) => (
              <li
                key={item.href}
                style={{
                  transition: `opacity ${mobileOpen ? 450 : 150}ms ease-out, transform ${
                    mobileOpen ? 450 : 150
                  }ms ease-out`,
                  transitionDelay: mobileOpen ? `${120 + i * 70}ms` : '0ms',
                  opacity: mobileOpen ? 1 : 0,
                  transform: mobileOpen ? 'translateY(0)' : 'translateY(-16px)',
                }}
              >
                <Link
                  href={item.href}
                  onClick={closeMobile}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex items-center rounded-xl px-3 py-3.5 text-lg font-semibold transition-colors',
                    isActive(item.href)
                      ? 'bg-secondary text-primary'
                      : 'text-primary hover:bg-secondary',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div
            className="mt-auto border-t border-secondary px-4 py-6"
            style={{
              transition: `opacity ${mobileOpen ? 450 : 150}ms ease-out, transform ${
                mobileOpen ? 450 : 150
              }ms ease-out`,
              transitionDelay: mobileOpen ? `${120 + NAV.length * 70}ms` : '0ms',
              opacity: mobileOpen ? 1 : 0,
              transform: mobileOpen ? 'translateY(0)' : 'translateY(16px)',
            }}
          >
            {/* No theme toggle here — it already lives in the top bar, which
                stays visible while the menu is open. */}
            <Button
              href="/submit"
              color="primary"
              size="lg"
              iconLeading={Plus}
              onClick={closeMobile}
              className="w-full"
            >
              Submit a repo
            </Button>
          </div>
        </nav>
      </div>
    </>
  );
}
