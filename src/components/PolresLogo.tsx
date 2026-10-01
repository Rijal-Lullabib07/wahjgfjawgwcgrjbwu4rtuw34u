/** JAWARA Istimewa wordmark used throughout the application. */
export default function PolresLogo({ className = "" }: { className?: string }) {
  return (
    <span className="polres-logo">
      <img
        src="/logo-jawara-hd.png"
        alt="JAWARA Istimewa"
        width={2048}
        height={1152}
        decoding="async"
        className={`polres-logo-image object-contain drop-shadow-lg ${className}`}
      />
    </span>
  );
}
