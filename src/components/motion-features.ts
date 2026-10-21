// motion's DOM animation features, split into their own chunk so they load after the first render
// (see Providers): nothing on the first screen needs them to be readable.
import { domAnimation } from "motion/react";

export default domAnimation;
