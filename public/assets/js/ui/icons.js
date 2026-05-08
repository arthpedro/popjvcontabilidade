// ==========================================================================
// --- Shared SVG Icons ---
// ==========================================================================

function getTrashIconSvg() {
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M3 6h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M6.5 6l.8 14A2 2 0 0 0 9.3 22h5.4a2 2 0 0 0 2-1.9l.8-14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
}

function getSectorIconSvg(id) {
  switch (id) {
    case "departamento-pessoal":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    case "contabil":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M7 7h10M7 11h10M7 15h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>`;
    case "fiscal":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M21 10V7a2 2 0 0 0-2-2h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 14v3a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M7 7l10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    case "legalizacao-processos":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M12 2v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M5 8h14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          <rect x="4" y="10" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
          <path d="M8 14h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>`;
    case "ti":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
    default:
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.2"/>
        </svg>`;
  }
}

function getStaffActionIconSvg(type) {
  switch (type) {
    case "users":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="9.5" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M21 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    case "sectors":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    case "logs":
      return `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <path d="M6 3h9l3 3v15H6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M14 3v4h4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M9 11h6M9 15h6M9 19h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
    default:
      return "";
  }
}

const wordFileIconSvg = `
  <svg viewBox="0 0 1881.25 1750" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <path fill="#41A5EE" d="M1801.056,0H517.694C473.404,0,437.5,35.904,437.5,80.194c0,0,0,0,0,0V437.5l743.75,218.75l700-218.75V80.194C1881.25,35.904,1845.346,0,1801.056,0L1801.056,0z"/>
    <path fill="#2B7CD3" d="M1881.25,437.5H437.5V875l743.75,131.25l700-131.25V437.5z"/>
    <path fill="#185ABD" d="M437.5,875v437.5l700,87.5l743.75-87.5V875H437.5z"/>
    <path fill="#103F91" d="M517.694,1750h1283.363c44.29,0,80.194-35.904,80.194-80.194l0,0V1312.5H437.5v357.306C437.5,1714.096,473.404,1750,517.694,1750L517.694,1750z"/>
    <path opacity="0.1" d="M969.806,350H437.5v1093.75h532.306c44.23-0.144,80.05-35.964,80.194-80.194V430.194C1049.856,385.964,1014.036,350.144,969.806,350z"/>
    <path opacity="0.2" d="M926.056,393.75H437.5V1487.5h488.556c44.23-0.144,80.05-35.964,80.194-80.194V473.944C1006.106,429.714,970.286,393.894,926.056,393.75z"/>
    <path opacity="0.2" d="M926.056,393.75H437.5V1400h488.556c44.23-0.144,80.05-35.964,80.194-80.194V473.944C1006.106,429.714,970.286,393.894,926.056,393.75z"/>
    <path opacity="0.2" d="M882.306,393.75H437.5V1400h444.806c44.23-0.144,80.05-35.964,80.194-80.194V473.944C962.356,429.714,926.536,393.894,882.306,393.75z"/>
    <linearGradient id="wordIconGradient" gradientUnits="userSpaceOnUse" x1="167.2057" y1="1420.9117" x2="795.2943" y2="333.0883" gradientTransform="matrix(1 0 0 -1 0 1752)">
      <stop offset="0" stop-color="#2368C4"/>
      <stop offset="0.5" stop-color="#1A5DBE"/>
      <stop offset="1" stop-color="#1146AC"/>
    </linearGradient>
    <path fill="url(#wordIconGradient)" d="M80.194,393.75h802.112c44.29,0,80.194,35.904,80.194,80.194v802.113c0,44.29-35.904,80.194-80.194,80.194H80.194c-44.29,0-80.194-35.904-80.194-80.194V473.944C0,429.654,35.904,393.75,80.194,393.75z"/>
    <path fill="#FFFFFF" d="M329.088,1008.788c1.575,12.381,2.625,23.144,3.106,32.375h1.837c0.7-8.75,2.158-19.294,4.375-31.631c2.217-12.338,4.215-22.765,5.994-31.281l84.35-363.913h109.069l87.5,358.444c5.084,22.288,8.723,44.881,10.894,67.637h1.444c1.631-22.047,4.671-43.966,9.1-65.625l69.781-360.631h99.269l-122.588,521.5H577.238L494.113,790.3c-2.406-9.931-5.162-22.925-8.181-38.894c-3.019-15.969-4.9-27.65-5.644-35h-1.444c-0.962,8.487-2.844,21.088-5.644,37.8c-2.8,16.713-5.046,29.079-6.738,37.1l-78.138,344.269h-117.95L147.131,614.337h101.062l75.994,364.656C325.894,986.475,327.513,996.45,329.088,1008.788z"/>
  </svg>`;

function getThemeIconSvg(name) {
  if (name === 'sun') {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/>
        <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="M4.93 4.93l1.41 1.41" />
          <path d="M17.66 17.66l1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="M4.93 19.07l1.41-1.41" />
          <path d="M17.66 6.34l1.41-1.41" />
        </g>
      </svg>`;
  }

  return `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}
