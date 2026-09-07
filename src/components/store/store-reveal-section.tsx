"use client";

import { useEffect, useRef } from "react";

export function StoreRevealSection({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel?: string;
  children: React.ReactNode;
  className: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!window.IntersectionObserver) {
      section.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      section.classList.add("is-visible");
      observer.disconnect();
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return <section aria-label={ariaLabel} className={`${className} store-scroll-reveal`} ref={sectionRef}>{children}</section>;
}
