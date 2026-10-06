import Link from "next/link";
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 3v26M16 3v26M25 3v26M3 7h26M3 16h26M3 25h26"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path
        d="M7 7l18 18M7 16l9 9M16 7l9 9"
        stroke="currentColor"
        strokeWidth="2.4"
      />
    </svg>
  );
}
export function Brand({
  href = "/",
  light = false,
}: {
  href?: string;
  light?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`brand${light ? " brand-light" : ""}`}
      aria-label="Lattice home"
    >
      <Mark />
      <span>
        lattice<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
