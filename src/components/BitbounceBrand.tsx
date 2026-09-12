import logo from "../assets/branding/bitbounce-logo.svg";

export default function BitbounceBrand() {
  return (
    <div class="bitbounce-brand" role="img" aria-label="Bitbounce">
      <img src={logo} alt="" width="48" height="48" decoding="async" />
      <span aria-hidden="true">
        Bitbounce<span class="brand-period">.</span>
      </span>
    </div>
  );
}
