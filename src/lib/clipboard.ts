/**
 * Salin teks ke clipboard — dipakai tombol "Salin narasi" di sisi pelapor
 * (dan pemantau bila perlu). Memakai Clipboard API bila tersedia; kalau tidak
 * (browser lama / WebView), jatuh ke trik textarea + execCommand lama.
 * Mengembalikan `true` bila berhasil, `false` bila gagal — pemanggil yang
 * menampilkan status "Tersalin / Gagal".
 */
export async function salinTeks(teks: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(teks);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = teks;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
