/** JAWARA Polres Purwakarta logo used throughout the application. */
export default function PolresLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/jawara-logo.png"
      alt="JAWARA Polres Purwakarta"
      className={`object-contain drop-shadow-lg ${className}`}
    />
  );
}
