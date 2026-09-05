/**
 * The frame before a shared deck, for the same reason as the stage's: the
 * viewer is black, and a white page before it is the only white thing a
 * reader would ever see.
 */
export default function SharedLoading() {
  return <div className="h-screen w-screen bg-black" aria-busy="true" aria-label="Loading" />;
}
