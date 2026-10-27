// Static SVG geometry preserves the approved desktop and mobile layouts during SSR.
export const DesktopLayers = () => (
  <svg
    className="desktop-layers"
    role="img"
    aria-label="Layered diagram of applications, toolkits, Mutter, Xorg, Linux input drivers, and keyboard hardware with the focus bug marked"
    viewBox="0 0 980 915"
  >
    <title>
      {
        "Simplified Linaro-style layers: applications, user-space components, kernel, hardware"
      }
    </title>
    <desc>
      {
        "GTK4 in Files sends a bogus future drop timestamp to GTK3 in Firefox. Firefox caches it and requests activation. Mutter raises Firefox and sends WM_TAKE_FOCUS with that time. Firefox requests X focus. Xorg ignores the future time, so keyboard focus remains in Slack. With a valid time, Xorg would move focus to Firefox. Toolkits are libraries inside application processes, even though their responsibilities are shown on another row."
      }
    </desc>
    <defs>
      <marker
        id="desktop-arrow-protocol"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-protocol)"></path>
      </marker>
      <marker
        id="desktop-arrow-failure"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-failure)"></path>
      </marker>
      <marker
        id="desktop-arrow-healthy"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-healthy)"></path>
      </marker>
    </defs>
    <text x="880" y="91" className="strong" textAnchor="start">
      <tspan x="880" dy="0">
        {"Applications"}
      </tspan>
    </text>
    <rect
      x="20"
      y="60"
      width="255.33333333333334"
      height="56"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="147.66666666666669" y="84" className="strong" textAnchor="middle">
      <tspan x="147.66666666666669" dy="0">
        {"Files / Nautilus"}
      </tspan>
    </text>
    <text x="147.66666666666669" y="109" className="" textAnchor="middle">
      <tspan x="147.66666666666669" dy="0">
        {"File manager"}
      </tspan>
    </text>
    <rect
      x="303.33333333333337"
      y="60"
      width="255.33333333333334"
      height="56"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="431.00000000000006" y="84" className="strong" textAnchor="middle">
      <tspan x="431.00000000000006" dy="0">
        {"Firefox"}
      </tspan>
    </text>
    <text x="431.00000000000006" y="109" className="" textAnchor="middle">
      <tspan x="431.00000000000006" dy="0">
        {"Browser"}
      </tspan>
    </text>
    <rect
      x="586.6666666666667"
      y="60"
      width="255.33333333333334"
      height="56"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="714.3333333333334" y="84" className="strong" textAnchor="middle">
      <tspan x="714.3333333333334" dy="0">
        {"Slack"}
      </tspan>
    </text>
    <text x="714.3333333333334" y="109" className="" textAnchor="middle">
      <tspan x="714.3333333333334" dy="0">
        {"Previous app"}
      </tspan>
    </text>
    <line
      x1="0"
      y1="145"
      x2="980"
      y2="145"
      stroke="var(--color-divider)"
      strokeWidth="1"
    ></line>
    <text x="880" y="181" className="strong" textAnchor="start">
      <tspan x="880" dy="0">
        {"User-space"}
      </tspan>
      <tspan x="880" dy="18">
        {"components"}
      </tspan>
    </text>
    <rect
      x="20"
      y="205"
      width="255.33333333333334"
      height="124"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="147.66666666666669" y="229" className="strong" textAnchor="middle">
      <tspan x="147.66666666666669" dy="0">
        {"GTK4"}
      </tspan>
    </text>
    <text x="147.66666666666669" y="254" className="" textAnchor="middle">
      <tspan x="147.66666666666669" dy="0">
        {"Widgets + drag-and-drop"}
      </tspan>
    </text>
    <text
      x="147.66666666666669"
      y="290"
      className="fault"
      textAnchor="middle"
      data-example-target="missing"
    >
      <tspan x="147.66666666666669" dy="0">
        {"1  Missing callback argument"}
      </tspan>
      <tspan x="147.66666666666669" dy="18">
        {"   becomes bogus time T"}
      </tspan>
    </text>
    <rect
      x="303.33333333333337"
      y="205"
      width="255.33333333333334"
      height="124"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="431.00000000000006" y="229" className="strong" textAnchor="middle">
      <tspan x="431.00000000000006" dy="0">
        {"GTK3"}
      </tspan>
    </text>
    <text x="431.00000000000006" y="254" className="" textAnchor="middle">
      <tspan x="431.00000000000006" dy="0">
        {"Linux window integration"}
      </tspan>
    </text>
    <text
      x="431.00000000000006"
      y="290"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="431.00000000000006" dy="0">
        {"2  Caches future T;"}
      </tspan>
      <tspan x="431.00000000000006" dy="18">
        {"   real input looks older"}
      </tspan>
    </text>
    <rect
      x="586.6666666666667"
      y="205"
      width="255.33333333333334"
      height="124"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="714.3333333333334" y="229" className="strong" textAnchor="middle">
      <tspan x="714.3333333333334" dy="0">
        {"Electron / Chromium"}
      </tspan>
    </text>
    <text x="714.3333333333334" y="254" className="" textAnchor="middle">
      <tspan x="714.3333333333334" dy="0">
        {"Slack UI + integration"}
      </tspan>
    </text>
    <text
      x="714.3333333333334"
      y="308"
      className="fault"
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="714.3333333333334" dy="0">
        {"5  Receives the keys"}
      </tspan>
    </text>
    <path
      d="M147.66666666666669,116V205"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <path
      d="M431.00000000000006,116V205"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <path
      d="M714.3333333333334,116V205"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <rect
      x="278.6"
      y="159"
      width="304.79999999999995"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text x="431" y="172" className="" textAnchor="middle">
      <tspan x="431" dy="0">
        {"Toolkits are libraries inside their applications"}
      </tspan>
    </text>
    <path
      d="M275.33333333333337,266H303.33333333333337"
      fill="none"
      stroke="var(--focus-failure)"
      strokeWidth="2.2"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-failure)"
    ></path>
    <rect
      x="237.58333333333337"
      y="340"
      width="103.5"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text
      x="289.33333333333337"
      y="353"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="289.33333333333337" dy="0">
        {"1 \u00B7 XdndDrop(T)"}
      </tspan>
    </text>
    <path
      d="M147.66666666666669,329V390"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
    ></path>
    <path
      d="M431.00000000000006,329V390"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
    ></path>
    <path
      d="M714.3333333333334,329V390"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
    ></path>
    <path
      d="M147.66666666666669,390H714.3333333333334"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
    ></path>
    <path
      d="M566.0466666666666,390V450"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <rect
      x="495.9966666666666"
      y="408"
      width="140.1"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text x="566.0466666666666" y="421" className="" textAnchor="middle">
      <tspan x="566.0466666666666" dy="0">
        {"X11 requests / events"}
      </tspan>
    </text>
    <rect
      x="20"
      y="450"
      width="259.33333333333337"
      height="180"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="149.66666666666669" y="474" className="strong" textAnchor="middle">
      <tspan x="149.66666666666669" dy="0">
        {"Mutter"}
      </tspan>
    </text>
    <text x="149.66666666666669" y="499" className="" textAnchor="middle">
      <tspan x="149.66666666666669" dy="0">
        {"Inside GNOME Shell"}
      </tspan>
      <tspan x="149.66666666666669" dy="18">
        {"Chooses active window"}
      </tspan>
      <tspan x="149.66666666666669" dy="18">
        {"Composes desktop image"}
      </tspan>
    </text>
    <text
      x="149.66666666666669"
      y="591"
      className="fault"
      textAnchor="middle"
      data-example-target="takefocus"
    >
      <tspan x="149.66666666666669" dy="0">
        {"3  Makes Firefox active"}
      </tspan>
      <tspan x="149.66666666666669" dy="18">
        {"   WM_TAKE_FOCUS(T)"}
      </tspan>
    </text>
    <rect
      x="321.33333333333337"
      y="450"
      width="520.6666666666666"
      height="180"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="581.6666666666667" y="474" className="strong" textAnchor="middle">
      <tspan x="581.6666666666667" dy="0">
        {"Xorg \u00B7 X11 server"}
      </tspan>
    </text>
    <text x="581.6666666666667" y="499" className="" textAnchor="middle">
      <tspan x="581.6666666666667" dy="0">
        {"Window / event protocol endpoint"}
      </tspan>
      <tspan x="581.6666666666667" dy="18">
        {"Owns keyboard focus"}
      </tspan>
      <tspan x="581.6666666666667" dy="18">
        {"Receives XSetInputFocus(T)"}
      </tspan>
    </text>
    <text
      x="581.6666666666667"
      y="591"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="581.6666666666667" dy="0">
        {"4  Future focus timestamp T is ignored."}
      </tspan>
      <tspan x="581.6666666666667" dy="18">
        {"   Actual keyboard focus stays in Slack."}
      </tspan>
    </text>
    <path
      d="M321.33333333333337,515H279.33333333333337"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <path
      d="M279.33333333333337,560H321.33333333333337"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <rect
      x="285.1833333333334"
      y="527"
      width="30.299999999999997"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text x="300.33333333333337" y="540" className="" textAnchor="middle">
      <tspan x="300.33333333333337" dy="0">
        {"X11"}
      </tspan>
    </text>
    <path
      d="M489.7266666666667,450V329"
      fill="none"
      stroke="var(--focus-healthy)"
      strokeWidth="1.5"
      strokeDasharray="5 5"
      markerEnd="url(#desktop-arrow-healthy)"
    ></path>
    <rect
      x="447.12666666666667"
      y="355"
      width="85.19999999999999"
      height="40"
      fill="var(--color-background)"
    ></rect>
    <text
      x="489.7266666666667"
      y="368"
      className=""
      textAnchor="middle"
      data-example-target="real"
    >
      <tspan x="489.7266666666667" dy="0">
        {"Valid T:"}
      </tspan>
      <tspan x="489.7266666666667" dy="18">
        {"focus + keys"}
      </tspan>
    </text>
    <path
      d="M842,564H858V267H842.0000000000001"
      fill="none"
      stroke="var(--focus-failure)"
      strokeWidth="2.2"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-failure)"
    ></path>
    <path
      d="M783.2733333333334,205V116"
      fill="none"
      stroke="var(--focus-failure)"
      strokeWidth="2.2"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-failure)"
    ></path>
    <rect
      x="635.9833333333333"
      y="662"
      width="176.7"
      height="40"
      fill="var(--color-background)"
    ></rect>
    <text x="724.3333333333334" y="675" className="fault" textAnchor="middle">
      <tspan x="724.3333333333334" dy="0">
        {"Firefox looks active."}
      </tspan>
      <tspan x="724.3333333333334" dy="18">
        {"Slack holds keyboard focus."}
      </tspan>
    </text>
    <line
      x1="0"
      y1="715"
      x2="980"
      y2="715"
      stroke="var(--color-divider)"
      strokeWidth="1"
    ></line>
    <text x="880" y="751" className="strong" textAnchor="start">
      <tspan x="880" dy="0">
        {"Kernel"}
      </tspan>
    </text>
    <rect
      x="321.33333333333337"
      y="744"
      width="520.6666666666666"
      height="55"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="581.6666666666667" y="768" className="strong" textAnchor="middle">
      <tspan x="581.6666666666667" dy="0">
        {"Linux input subsystem"}
      </tspan>
    </text>
    <text
      x="581.6666666666667"
      y="793"
      className=""
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="581.6666666666667" dy="0">
        {"Keyboard driver / input events"}
      </tspan>
    </text>
    <path
      d="M503.5666666666667,744V630"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <line
      x1="0"
      y1="815"
      x2="980"
      y2="815"
      stroke="var(--color-divider)"
      strokeWidth="1"
    ></line>
    <text x="880" y="851" className="strong" textAnchor="start">
      <tspan x="880" dy="0">
        {"Hardware"}
      </tspan>
    </text>
    <rect
      x="321.33333333333337"
      y="834"
      width="520.6666666666666"
      height="55"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text
      x="581.6666666666667"
      y="858"
      className="strong"
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="581.6666666666667" dy="0">
        {"Physical keyboard"}
      </tspan>
    </text>
    <path
      d="M503.5666666666667,834V799"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#desktop-arrow-protocol)"
    ></path>
    <text x="149.66666666666669" y="670" className="muted" textAnchor="middle">
      <tspan x="149.66666666666669" dy="0">
        {"GTK + Electron run inside apps."}
      </tspan>
      <tspan x="149.66666666666669" dy="18">
        {"Mutter + Xorg cooperate via IPC."}
      </tspan>
    </text>
  </svg>
)
export const MobileLayers = () => (
  <svg
    className="mobile-layers"
    role="img"
    aria-label="Layered diagram of applications, toolkits, Mutter, Xorg, Linux input drivers, and keyboard hardware with the focus bug marked"
    viewBox="0 0 343 1710"
  >
    <title>
      {
        "Simplified Linaro-style layers: applications, user-space components, kernel, hardware"
      }
    </title>
    <desc>
      {
        "GTK4 in Files sends a bogus future drop timestamp to GTK3 in Firefox. Firefox caches it and requests activation. Mutter raises Firefox and sends WM_TAKE_FOCUS with that time. Firefox requests X focus. Xorg ignores the future time, so keyboard focus remains in Slack. With a valid time, Xorg would move focus to Firefox. Toolkits are libraries inside application processes, even though their responsibilities are shown on another row."
      }
    </desc>
    <defs>
      <marker
        id="mobile-arrow-protocol"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-protocol)"></path>
      </marker>
      <marker
        id="mobile-arrow-failure"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-failure)"></path>
      </marker>
      <marker
        id="mobile-arrow-healthy"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0 0L8 4L0 8Z" fill="var(--focus-healthy)"></path>
      </marker>
    </defs>
    <line x1="0" y1="35" x2="343" y2="35" stroke="var(--color-divider)"></line>
    <text x="8" y="57" className="muted" textAnchor="start">
      <tspan x="8" dy="0">
        {"APPLICATIONS + THEIR LIBRARIES"}
      </tspan>
    </text>
    <rect
      x="26"
      y="80"
      width="285"
      height="55"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="104" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Files / Nautilus"}
      </tspan>
    </text>
    <text x="168.5" y="129" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"File manager"}
      </tspan>
    </text>
    <rect
      x="26"
      y="175"
      width="285"
      height="123"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="199" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"GTK4 \u00B7 library in Files"}
      </tspan>
    </text>
    <text x="168.5" y="224" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Widgets + drag-and-drop"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="277"
      className="fault"
      textAnchor="middle"
      data-example-target="missing"
    >
      <tspan x="168.5" dy="0">
        {"1  Callback emits bogus future T"}
      </tspan>
    </text>
    <path
      d="M168.5,135V175"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <rect
      x="113.7"
      y="146"
      width="109.6"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text x="168.5" y="159" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"In-process calls"}
      </tspan>
    </text>
    <path
      d="M168.5,298V358"
      fill="none"
      stroke="var(--focus-failure)"
      strokeWidth="2.2"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-failure)"
    ></path>
    <rect
      x="128.95"
      y="318"
      width="79.1"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text
      x="168.5"
      y="331"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="168.5" dy="0">
        {"XdndDrop(T)"}
      </tspan>
    </text>
    <rect
      x="26"
      y="358"
      width="285"
      height="55"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="382" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Firefox"}
      </tspan>
    </text>
    <text x="168.5" y="407" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Browser; its own UI renderer"}
      </tspan>
    </text>
    <rect
      x="26"
      y="453"
      width="285"
      height="145"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="477" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"GTK3 \u00B7 library in Firefox"}
      </tspan>
    </text>
    <text x="168.5" y="502" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Linux window integration"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="559"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="168.5" dy="0">
        {"2  Caches T; real input looks older."}
      </tspan>
      <tspan x="168.5" dy="18">
        {"   Later activation reuses T."}
      </tspan>
    </text>
    <path
      d="M168.5,413V453"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <rect
      x="113.7"
      y="425"
      width="109.6"
      height="22"
      fill="var(--color-background)"
    ></rect>
    <text x="168.5" y="438" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"In-process calls"}
      </tspan>
    </text>
    <path
      d="M168.5,598V710"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <rect
      x="95.4"
      y="637"
      width="146.2"
      height="40"
      fill="var(--color-background)"
    ></rect>
    <text x="168.5" y="650" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Activation request (T)"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"X11 messages via Xorg"}
      </tspan>
    </text>
    <line
      x1="0"
      y1="670"
      x2="343"
      y2="670"
      stroke="var(--color-divider)"
    ></line>
    <text x="8" y="692" className="muted" textAnchor="start">
      <tspan x="8" dy="0">
        {"SHARED USER-SPACE SERVICES"}
      </tspan>
    </text>
    <rect
      x="26"
      y="710"
      width="285"
      height="178"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="734" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Mutter \u00B7 in GNOME Shell"}
      </tspan>
    </text>
    <text x="168.5" y="759" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Window manager + compositor"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"Chooses active window + stacking"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"Combines windows into desktop"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="849"
      className="fault"
      textAnchor="middle"
      data-example-target="takefocus"
    >
      <tspan x="168.5" dy="0">
        {"3  Raises Firefox; sends"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"   WM_TAKE_FOCUS(T)"}
      </tspan>
    </text>
    <path
      d="M26,826H10V510H26"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <rect
      x="110.65"
      y="916"
      width="115.69999999999999"
      height="40"
      fill="var(--color-background)"
    ></rect>
    <text x="168.5" y="929" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Firefox responds:"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"XSetInputFocus(T)"}
      </tspan>
    </text>
    <rect
      x="26"
      y="985"
      width="285"
      height="195"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="1009" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Xorg \u00B7 X11 server process"}
      </tspan>
    </text>
    <text x="168.5" y="1034" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Protocol / event endpoint"}
      </tspan>
      <tspan x="168.5" dy="18">
        {"Owns actual keyboard focus"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="1141"
      className="fault"
      textAnchor="middle"
      data-example-target="future"
    >
      <tspan x="168.5" dy="0">
        {"4  Future T: ignore focus request."}
      </tspan>
      <tspan x="168.5" dy="18">
        {"   Keyboard focus stays in Slack."}
      </tspan>
    </text>
    <path
      d="M311,564H335V1052H311"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <path
      d="M311,1100H324V485H311"
      fill="none"
      stroke="var(--focus-healthy)"
      strokeWidth="1.5"
      strokeDasharray="5 5"
      markerEnd="url(#mobile-arrow-healthy)"
    ></path>
    <rect
      x="26"
      y="1245"
      width="285"
      height="105"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="1269" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Slack \u00B7 previous app"}
      </tspan>
    </text>
    <text x="168.5" y="1294" className="" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Electron / Chromium integration"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="1329"
      className="fault"
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="168.5" dy="0">
        {"5  Keys go to Slack\u2019s text field"}
      </tspan>
    </text>
    <path
      d="M168.5,1180V1245"
      fill="none"
      stroke="var(--focus-failure)"
      strokeWidth="2.2"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-failure)"
    ></path>
    <line
      x1="0"
      y1="1390"
      x2="343"
      y2="1390"
      stroke="var(--color-divider)"
    ></line>
    <text x="8" y="1412" className="muted" textAnchor="start">
      <tspan x="8" dy="0">
        {"KERNEL"}
      </tspan>
    </text>
    <rect
      x="26"
      y="1435"
      width="285"
      height="68"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text x="168.5" y="1459" className="strong" textAnchor="middle">
      <tspan x="168.5" dy="0">
        {"Linux input subsystem"}
      </tspan>
    </text>
    <text
      x="168.5"
      y="1484"
      className=""
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="168.5" dy="0">
        {"Device drivers / input events"}
      </tspan>
    </text>
    <path
      d="M26,1465H16V1125H26"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
    <line
      x1="0"
      y1="1545"
      x2="343"
      y2="1545"
      stroke="var(--color-divider)"
    ></line>
    <text x="8" y="1567" className="muted" textAnchor="start">
      <tspan x="8" dy="0">
        {"HARDWARE"}
      </tspan>
    </text>
    <rect
      x="26"
      y="1595"
      width="285"
      height="55"
      fill="var(--color-card)"
      stroke="var(--color-text)"
      strokeWidth="1.2"
    ></rect>
    <text
      x="168.5"
      y="1619"
      className="strong"
      textAnchor="middle"
      data-example-target="key"
    >
      <tspan x="168.5" dy="0">
        {"Physical keyboard"}
      </tspan>
    </text>
    <path
      d="M168.5,1595V1503"
      fill="none"
      stroke="var(--focus-protocol)"
      strokeWidth="1.5"
      strokeDasharray=""
      markerEnd="url(#mobile-arrow-protocol)"
    ></path>
  </svg>
)
