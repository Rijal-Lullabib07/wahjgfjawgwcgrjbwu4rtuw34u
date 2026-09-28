/** JAWARA Istimewa wordmark used throughout the application. */
export default function PolresLogo({ className = "" }: { className?: string }) {
  return (
    <span className="polres-logo">
      <img
        src="/logo-jawara-istimewa-2.png"
        alt="JAWARA Istimewa"
        decoding="async"
        className={`polres-logo-image object-contain drop-shadow-lg ${className}`}
      />
    </span>
  );
}
