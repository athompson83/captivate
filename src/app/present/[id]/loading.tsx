/**
 * The frame before the stage.
 *
 * The route awaits the deck on the server, and until it resolves the window
 * showed the site's light body — a white flash on a projector before the
 * first scene. The stage is black; so is the moment before it.
 */
export default function PresentLoading() {
  return <div className="h-screen w-screen bg-black" aria-busy="true" aria-label="Loading" />;
}
