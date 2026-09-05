/**
 * The symbols a diagram may place.
 *
 * Every one is a Lucide icon read as path data rather than rendered as a
 * component, so it can be laid down as strokes in a drawing — scaled into its
 * box, sketched in stage order, weighted and coloured like every other stroke
 * on the picture. The set is curated: names the model can reason about,
 * grouped by what a diagram is usually *of*, and every entry is checked by a
 * test against the installed icon set so a renamed icon fails at build time
 * rather than drawing a blank.
 *
 * A plain module with no React in it, because the compiler runs on the
 * server inside the generation pass and in tests.
 */

import { __iconNode as activity } from "lucide-react/dist/esm/icons/activity.mjs";
import { __iconNode as alertTriangle } from "lucide-react/dist/esm/icons/triangle-alert.mjs";
import { __iconNode as ambulance } from "lucide-react/dist/esm/icons/ambulance.mjs";
import { __iconNode as arrowRight } from "lucide-react/dist/esm/icons/arrow-right.mjs";
import { __iconNode as atom } from "lucide-react/dist/esm/icons/atom.mjs";
import { __iconNode as baby } from "lucide-react/dist/esm/icons/baby.mjs";
import { __iconNode as bandage } from "lucide-react/dist/esm/icons/bandage.mjs";
import { __iconNode as banknote } from "lucide-react/dist/esm/icons/banknote.mjs";
import { __iconNode as battery } from "lucide-react/dist/esm/icons/battery.mjs";
import { __iconNode as bed } from "lucide-react/dist/esm/icons/bed.mjs";
import { __iconNode as bell } from "lucide-react/dist/esm/icons/bell.mjs";
import { __iconNode as biohazard } from "lucide-react/dist/esm/icons/biohazard.mjs";
import { __iconNode as bone } from "lucide-react/dist/esm/icons/bone.mjs";
import { __iconNode as bookOpen } from "lucide-react/dist/esm/icons/book-open.mjs";
import { __iconNode as box } from "lucide-react/dist/esm/icons/box.mjs";
import { __iconNode as brain } from "lucide-react/dist/esm/icons/brain.mjs";
import { __iconNode as bug } from "lucide-react/dist/esm/icons/bug.mjs";
import { __iconNode as building } from "lucide-react/dist/esm/icons/building.mjs";
import { __iconNode as calendar } from "lucide-react/dist/esm/icons/calendar.mjs";
import { __iconNode as car } from "lucide-react/dist/esm/icons/car.mjs";
import { __iconNode as checkCircle } from "lucide-react/dist/esm/icons/circle-check-big.mjs";
import { __iconNode as clipboardCheck } from "lucide-react/dist/esm/icons/clipboard-check.mjs";
import { __iconNode as clock } from "lucide-react/dist/esm/icons/clock.mjs";
import { __iconNode as cloud } from "lucide-react/dist/esm/icons/cloud.mjs";
import { __iconNode as cloudRain } from "lucide-react/dist/esm/icons/cloud-rain.mjs";
import { __iconNode as coins } from "lucide-react/dist/esm/icons/coins.mjs";
import { __iconNode as compass } from "lucide-react/dist/esm/icons/compass.mjs";
import { __iconNode as cpu } from "lucide-react/dist/esm/icons/cpu.mjs";
import { __iconNode as database } from "lucide-react/dist/esm/icons/database.mjs";
import { __iconNode as dna } from "lucide-react/dist/esm/icons/dna.mjs";
import { __iconNode as droplet } from "lucide-react/dist/esm/icons/droplet.mjs";
import { __iconNode as droplets } from "lucide-react/dist/esm/icons/droplets.mjs";
import { __iconNode as ear } from "lucide-react/dist/esm/icons/ear.mjs";
import { __iconNode as eye } from "lucide-react/dist/esm/icons/eye.mjs";
import { __iconNode as factory } from "lucide-react/dist/esm/icons/factory.mjs";
import { __iconNode as fileText } from "lucide-react/dist/esm/icons/file-text.mjs";
import { __iconNode as flag } from "lucide-react/dist/esm/icons/flag.mjs";
import { __iconNode as flame } from "lucide-react/dist/esm/icons/flame.mjs";
import { __iconNode as flaskConical } from "lucide-react/dist/esm/icons/flask-conical.mjs";
import { __iconNode as footprints } from "lucide-react/dist/esm/icons/footprints.mjs";
import { __iconNode as frown } from "lucide-react/dist/esm/icons/face-slightly-frowning.mjs";
import { __iconNode as gauge } from "lucide-react/dist/esm/icons/gauge.mjs";
import { __iconNode as gitBranch } from "lucide-react/dist/esm/icons/git-branch.mjs";
import { __iconNode as globe } from "lucide-react/dist/esm/icons/globe.mjs";
import { __iconNode as graduationCap } from "lucide-react/dist/esm/icons/graduation-cap.mjs";
import { __iconNode as hand } from "lucide-react/dist/esm/icons/hand.mjs";
import { __iconNode as heart } from "lucide-react/dist/esm/icons/heart.mjs";
import { __iconNode as heartPulse } from "lucide-react/dist/esm/icons/heart-pulse.mjs";
import { __iconNode as home } from "lucide-react/dist/esm/icons/house.mjs";
import { __iconNode as hospital } from "lucide-react/dist/esm/icons/hospital.mjs";
import { __iconNode as hourglass } from "lucide-react/dist/esm/icons/hourglass.mjs";
import { __iconNode as key } from "lucide-react/dist/esm/icons/key.mjs";
import { __iconNode as laptop } from "lucide-react/dist/esm/icons/laptop.mjs";
import { __iconNode as layers } from "lucide-react/dist/esm/icons/layers.mjs";
import { __iconNode as leaf } from "lucide-react/dist/esm/icons/leaf.mjs";
import { __iconNode as lightbulb } from "lucide-react/dist/esm/icons/lightbulb.mjs";
import { __iconNode as lock } from "lucide-react/dist/esm/icons/lock.mjs";
import { __iconNode as magnet } from "lucide-react/dist/esm/icons/magnet.mjs";
import { __iconNode as mail } from "lucide-react/dist/esm/icons/mail.mjs";
import { __iconNode as mapPin } from "lucide-react/dist/esm/icons/map-pin.mjs";
import { __iconNode as megaphone } from "lucide-react/dist/esm/icons/megaphone.mjs";
import { __iconNode as messageCircle } from "lucide-react/dist/esm/icons/message-circle.mjs";
import { __iconNode as microscope } from "lucide-react/dist/esm/icons/microscope.mjs";
import { __iconNode as monitor } from "lucide-react/dist/esm/icons/monitor.mjs";
import { __iconNode as moon } from "lucide-react/dist/esm/icons/moon.mjs";
import { __iconNode as mountain } from "lucide-react/dist/esm/icons/mountain.mjs";
import { __iconNode as network } from "lucide-react/dist/esm/icons/network.mjs";
import { __iconNode as packageIcon } from "lucide-react/dist/esm/icons/package.mjs";
import { __iconNode as personStanding } from "lucide-react/dist/esm/icons/person-standing.mjs";
import { __iconNode as phone } from "lucide-react/dist/esm/icons/phone.mjs";
import { __iconNode as pill } from "lucide-react/dist/esm/icons/pill.mjs";
import { __iconNode as plane } from "lucide-react/dist/esm/icons/plane.mjs";
import { __iconNode as plug } from "lucide-react/dist/esm/icons/plug.mjs";
import { __iconNode as puzzle } from "lucide-react/dist/esm/icons/puzzle.mjs";
import { __iconNode as refreshCw } from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import { __iconNode as rocket } from "lucide-react/dist/esm/icons/rocket.mjs";
import { __iconNode as scale } from "lucide-react/dist/esm/icons/scale.mjs";
import { __iconNode as server } from "lucide-react/dist/esm/icons/server.mjs";
import { __iconNode as shield } from "lucide-react/dist/esm/icons/shield.mjs";
import { __iconNode as ship } from "lucide-react/dist/esm/icons/ship.mjs";
import { __iconNode as shoppingCart } from "lucide-react/dist/esm/icons/shopping-cart.mjs";
import { __iconNode as smile } from "lucide-react/dist/esm/icons/face-slightly-smiling.mjs";
import { __iconNode as stethoscope } from "lucide-react/dist/esm/icons/stethoscope.mjs";
import { __iconNode as sun } from "lucide-react/dist/esm/icons/sun.mjs";
import { __iconNode as syringe } from "lucide-react/dist/esm/icons/syringe.mjs";
import { __iconNode as target } from "lucide-react/dist/esm/icons/target.mjs";
import { __iconNode as testTube } from "lucide-react/dist/esm/icons/test-tube.mjs";
import { __iconNode as thermometer } from "lucide-react/dist/esm/icons/thermometer.mjs";
import { __iconNode as timer } from "lucide-react/dist/esm/icons/timer.mjs";
import { __iconNode as treePine } from "lucide-react/dist/esm/icons/tree-pine.mjs";
import { __iconNode as trendingDown } from "lucide-react/dist/esm/icons/trending-down.mjs";
import { __iconNode as trendingUp } from "lucide-react/dist/esm/icons/trending-up.mjs";
import { __iconNode as trophy } from "lucide-react/dist/esm/icons/trophy.mjs";
import { __iconNode as truck } from "lucide-react/dist/esm/icons/truck.mjs";
import { __iconNode as user } from "lucide-react/dist/esm/icons/user-round.mjs";
import { __iconNode as users } from "lucide-react/dist/esm/icons/users.mjs";
import { __iconNode as wallet } from "lucide-react/dist/esm/icons/wallet.mjs";
import { __iconNode as waves } from "lucide-react/dist/esm/icons/waves-horizontal.mjs";
import { __iconNode as wifi } from "lucide-react/dist/esm/icons/wifi.mjs";
import { __iconNode as wind } from "lucide-react/dist/esm/icons/wind.mjs";
import { __iconNode as wrench } from "lucide-react/dist/esm/icons/wrench.mjs";
import { __iconNode as xCircle } from "lucide-react/dist/esm/icons/circle-x.mjs";
import { __iconNode as zap } from "lucide-react/dist/esm/icons/zap.mjs";

/** One SVG primitive of an icon, in its 24×24 box. */
export type SymbolNode = [elementName: string, attrs: Record<string, string>][];

const SYMBOLS = {
  // People and bodies
  person: personStanding,
  user,
  people: users,
  baby,
  hand,
  eye,
  ear,
  footprints,
  smile,
  frown,

  // Clinical and life sciences
  heart,
  "heart-pulse": heartPulse,
  brain,
  bone,
  droplet,
  droplets,
  thermometer,
  syringe,
  pill,
  stethoscope,
  ambulance,
  hospital,
  bed,
  bandage,
  biohazard,
  dna,
  microscope,
  "test-tube": testTube,
  flask: flaskConical,
  bug,
  atom,
  activity,

  // Objects, places and vehicles
  building,
  home,
  factory,
  car,
  truck,
  plane,
  ship,
  rocket,
  phone,
  laptop,
  monitor,
  server,
  database,
  cpu,
  battery,
  plug,
  wifi,
  package: packageIcon,
  box,
  "shopping-cart": shoppingCart,
  wallet,
  coins,
  banknote,
  "file-text": fileText,
  "book-open": bookOpen,
  "graduation-cap": graduationCap,
  magnet,
  wrench,
  key,
  lock,
  shield,
  bell,
  mail,
  megaphone,
  "message-circle": messageCircle,

  // Nature and weather
  sun,
  moon,
  cloud,
  "cloud-rain": cloudRain,
  wind,
  waves,
  flame,
  leaf,
  "tree-pine": treePine,
  mountain,
  globe,

  // Time, measure and judgement
  clock,
  timer,
  hourglass,
  calendar,
  gauge,
  scale,
  target,
  trophy,
  flag,
  "map-pin": mapPin,
  compass,
  "trending-up": trendingUp,
  "trending-down": trendingDown,
  "check-circle": checkCircle,
  "x-circle": xCircle,
  "alert-triangle": alertTriangle,
  "clipboard-check": clipboardCheck,
  lightbulb,
  zap,

  // Structure
  "arrow-right": arrowRight,
  "refresh-cw": refreshCw,
  "git-branch": gitBranch,
  network,
  layers,
  puzzle,
} as const satisfies Record<string, SymbolNode>;

export type DiagramSymbol = keyof typeof SYMBOLS;

/** Every symbol name, for the schema's enum and the model's menu. */
export const DIAGRAM_SYMBOLS = Object.keys(SYMBOLS) as [DiagramSymbol, ...DiagramSymbol[]];

export function symbolNode(name: DiagramSymbol): SymbolNode {
  return SYMBOLS[name];
}
