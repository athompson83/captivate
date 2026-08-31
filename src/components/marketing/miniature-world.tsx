/**
 * The hero when WebGL is not available.
 *
 * Not a placeholder: a complete picture of the same claim in CSS, which is
 * what a visitor on a locked-down browser or a machine with no GPU sees. It
 * predates the WebGL hero and is kept whole rather than reduced to a spinner,
 * because a fallback nobody would notice is the only kind worth having.
 */
export function MiniatureWorld() {
  return (
    <div aria-hidden className="lw-panel aspect-[16/10.5] w-full select-none">
      {/* Flight path through the scene centres, in canvas coordinates. */}
      <svg className="lw-path" viewBox="0 0 100 66" preserveAspectRatio="none">
        <polyline
          points="14,19 37,12 55,21 56,27 20,48 46,45"
          fill="none"
          stroke="oklch(0.85 0.08 75 / 0.28)"
          strokeWidth="0.5"
          strokeDasharray="1.6 2.2"
          strokeLinecap="round"
        />
      </svg>

      {/* Title scene */}
      <div className="lw-scene" style={{ left: "6%", top: "10%", width: "30%", height: "38%" }}>
        <p
          className="m-0 text-[clamp(10px,1.6vw,19px)] leading-[1.05] font-semibold tracking-tight text-[oklch(0.95_0.02_80)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Hold the room
        </p>
        <div className="lw-bar" style={{ width: "62%" }} />
        <div className="lw-bar" style={{ width: "40%" }} />
      </div>

      {/* Bullets scene */}
      <div className="lw-scene" style={{ left: "44%", top: "4%", width: "24%", height: "30%" }}>
        <div className="lw-bar lw-bar--bright" style={{ width: "70%" }} />
        <div className="lw-bar" style={{ width: "88%" }} />
        <div className="lw-bar" style={{ width: "74%" }} />
        <div className="lw-bar lw-bar--accent" style={{ width: "52%" }} />
      </div>

      {/* Chart scene, with a tiny nested detail scene — the dive. */}
      <div
        className="lw-scene"
        style={{ left: "72.5%", top: "14%", width: "21%", height: "35%" }}
      >
        <div className="lw-bar lw-bar--bright" style={{ width: "58%" }} />
        <div className="lw-col">
          <i style={{ height: "42%" }} />
          <i style={{ height: "68%" }} />
          <i style={{ height: "30%" }} />
          <i style={{ height: "88%" }} />
        </div>
      </div>
      <div
        className="lw-scene"
        style={{ left: "80.5%", top: "35.5%", width: "7.5%", height: "11%", padding: "2% 1.5%" }}
      >
        <div className="lw-bar lw-bar--accent" style={{ width: "80%" }} />
        <div className="lw-bar" style={{ width: "60%" }} />
      </div>

      {/* Quote scene */}
      <div className="lw-scene" style={{ left: "17%", top: "56%", width: "26%", height: "33%" }}>
        <p
          className="m-0 text-[clamp(14px,2.2vw,28px)] leading-none text-[var(--accent)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          „
        </p>
        <div className="lw-bar" style={{ width: "84%" }} />
        <div className="lw-bar" style={{ width: "66%" }} />
        <div className="lw-bar lw-bar--bright" style={{ width: "36%" }} />
      </div>

      {/* Media scene */}
      <div className="lw-scene" style={{ left: "55%", top: "50%", width: "31%", height: "40%" }}>
        <div
          className="flex-1 rounded-[4px]"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.4 0.09 62 / 0.75), oklch(0.28 0.06 285 / 0.8))",
          }}
        />
        <div className="lw-bar" style={{ width: "48%" }} />
      </div>

      {/* The camera */}
      <div className="lw-cam" />
    </div>
  );
}
