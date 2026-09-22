/** JAWARA Polres Purwakarta logo used throughout the application. */
export default function PolresLogo({ className = "" }: { className?: string }) {
  return (
    <span className="polres-logo">
      <img
        src="/jawara-logo.png"
        alt="JAWARA Polres Purwakarta"
        decoding="async"
        className={`polres-logo-image object-contain drop-shadow-lg ${className}`}
      />
    </span>
  );
}
