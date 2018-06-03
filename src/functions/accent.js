// @flow
import defineFunction from "../defineFunction";
import buildCommon from "../buildCommon";
import mathMLTree from "../mathMLTree";
import utils from "../utils";
import stretchy from "../stretchy";
import ParseNode, {assertNodeType, checkNodeType} from "../ParseNode";

import * as html from "../buildHTML";
import * as mml from "../buildMathML";

import type {HtmlBuilderSupSub, MathMLBuilder} from "../defineFunction";

// NOTE: Unlike most `htmlBuilder`s, this one handles not only "accent", but
// also "supsub" since an accent can affect super/subscripting.
export const htmlBuilder: HtmlBuilderSupSub<"accent"> = (grp, options) => {
    // Accents are handled in the TeXbook pg. 443, rule 12.
    let base: ParseNode<*>;
    let group: ParseNode<"accent">;

    const supSub = checkNodeType(grp, "supsub");
    let supSubGroup;
    if (supSub) {
        // If our base is a character box, and we have superscripts and
        // subscripts, the supsub will defer to us. In particular, we want
        // to attach the superscripts and subscripts to the inner body (so
        // that the position of the superscripts and subscripts won't be
        // affected by the height of the accent). We accomplish this by
        // sticking the base of the accent into the base of the supsub, and
        // rendering that, while keeping track of where the accent is.

        // The real accent group is the base of the supsub group
        group = assertNodeType(supSub.value.base, "accent");
        // The character box is the base of the accent group
        base = group.value.base;
        // Stick the character box into the base of the supsub group
        supSub.value.base = base;

        // Rerender the supsub group with its new base, and store that
        // result.
        supSubGroup = html.buildGroup(supSub, options);
    } else {
        group = assertNodeType(grp, "accent");
        base = group.value.base;
    }

    // Build the base group
    const body = html.buildGroup(base, options.havingCrampedStyle());

    // Does the accent need to shift for the skew of a character?
    const mustShift = group.value.isShifty && utils.isCharacterBox(base);

    // Calculate the skew of the accent. This is based on the line "If the
    // nucleus is not a single character, let s = 0; otherwise set s to the
    // kern amount for the nucleus followed by the \skewchar of its font."
    // Note that our skew metrics are just the kern between each character
    // and the skewchar.
    let skew = 0;
    if (mustShift) {
        // If the base is a character box, then we want the skew of the
        // innermost character. To do that, we find the innermost character:
        const baseChar = utils.getBaseElem(base);
        // Then, we render its group to get the symbol inside it
        const baseGroup = html.buildGroup(baseChar, options.havingCrampedStyle());
        // Finally, we pull the skew off of the symbol.
        skew = baseGroup.skew;
        // Note that we now throw away baseGroup, because the layers we
        // removed with getBaseElem might contain things like \color which
        // we can't get rid of.
        // TODO(emily): Find a better way to get the skew
    }

    // calculate the amount of space between the body and the accent
    let clearance = Math.min(
        body.height,
        options.fontMetrics().xHeight);

    // Build the accent
    let accentBody;
    if (!group.value.isStretchy) {
        let accent;
        let width: number;
        if (group.value.label === "\\vec") {
            // Before version 0.9, \vec used the combining font glyph U+20D7.
            // But browsers, especially Safari, are not consistent in how they
            // render combining characters when not preceded by a character.
            // So now we use an SVG.
            // If Safari reforms, we should consider reverting to the glyph.
            accent = buildCommon.staticSvg("vec", options);
            width = buildCommon.svgData.vec[1];
        } else {
            accent = buildCommon.makeSymbol(
                group.value.label, "Main-Regular", group.mode, options);
            // Remove the italic correction of the accent, because it only serves to
            // shift the accent over to a place we don't want.
            accent.italic = 0;
            width = accent.width;
        }

        accentBody = buildCommon.makeSpan(["accent-body"], [accent]);

        // "Full" accents expand the width of the resulting symbol to be
        // at least the width of the accent, and overlap directly onto the
        // character without any vertical offset.
        const accentFull = (group.value.label === "\\textcircled");
        if (accentFull) {
            accentBody.classes.push('accent-full');
            clearance = body.height;
        }

        // Shift the accent over by the skew.
        let left = skew;

        // CSS defines `.katex .accent .accent-body:not(.accent-full) { width: 0 }`
        // so that the accent doesn't contribute to the bounding box.
        // We need to shift the character by its width (effectively half
        // its width) to compensate.
        if (!accentFull) {
            left -= width / 2;
        }

        accentBody.style.left = left + "em";

        // \textcircled uses the \bigcirc glyph, so it needs some
        // vertical adjustment to match LaTeX.
        if (group.value.label === "\\textcircled") {
            accentBody.style.top = ".2em";
        }

        accentBody = buildCommon.makeVList({
            positionType: "firstBaseline",
            children: [
                {type: "elem", elem: body},
                {type: "kern", size: -clearance},
                {type: "elem", elem: accentBody},
            ],
        }, options);

    } else {
        accentBody = stretchy.svgSpan(group, options);

        accentBody = buildCommon.makeVList({
            positionType: "firstBaseline",
            children: [
                {type: "elem", elem: body},
                {
                    type: "elem",
                    elem: accentBody,
                    wrapperClasses: ["svg-align"],
                    wrapperStyle: skew > 0
                        ? {
                            width: `calc(100% - ${2 * skew}em)`,
                            marginLeft: `${(2 * skew)}em`,
                        }
                        : undefined,
                },
            ],
        }, options);
    }

    const accentWrap =
        buildCommon.makeSpan(["mord", "accent"], [accentBody], options);

    if (supSubGroup) {
        // Here, we replace the "base" child of the supsub with our newly
        // generated accent.
        supSubGroup.children[0] = accentWrap;

        // Since we don't rerun the height calculation after replacing the
        // accent, we manually recalculate height.
        supSubGroup.height = Math.max(accentWrap.height, supSubGroup.height);

        // Accents should always be ords, even when their innards are not.
        supSubGroup.classes[0] = "mord";

        return supSubGroup;
    } else {
        return accentWrap;
    }
};

const mathmlBuilder: MathMLBuilder<"accent"> = (group, options) => {
    const groupValue = group.value;
    let accentNode;
    if (groupValue.isStretchy) {
        accentNode = stretchy.mathMLnode(groupValue.label);
    } else {
        accentNode = new mathMLTree.MathNode(
            "mo", [mml.makeText(groupValue.label, group.mode)]);
    }

    const node = new mathMLTree.MathNode(
        "mover",
        [mml.buildGroup(groupValue.base, options), accentNode]);

    node.setAttribute("accent", "true");

    return node;
};

const NON_STRETCHY_ACCENT_REGEX = new RegExp([
    "\\acute", "\\grave", "\\ddot", "\\tilde", "\\bar", "\\breve",
    "\\check", "\\hat", "\\vec", "\\dot", "\\mathring",
].map(accent => `\\${accent}`).join("|"));

// Accents
defineFunction({
    type: "accent",
    names: [
        "\\acute", "\\grave", "\\ddot", "\\tilde", "\\bar", "\\breve",
        "\\check", "\\hat", "\\vec", "\\dot", "\\mathring",
        "\\widehat", "\\widetilde", "\\overrightarrow", "\\overleftarrow",
        "\\Overrightarrow", "\\overleftrightarrow", "\\overgroup",
        "\\overlinesegment", "\\overleftharpoon", "\\overrightharpoon",
    ],
    props: {
        numArgs: 1,
    },
    handler: (context, args) => {
        const base = args[0];

        const isStretchy = !NON_STRETCHY_ACCENT_REGEX.test(context.funcName);
        const isShifty = !isStretchy ||
            context.funcName === "\\widehat" ||
            context.funcName === "\\widetilde";

        return new ParseNode("accent", {
            type: "accent",
            label: context.funcName,
            isStretchy: isStretchy,
            isShifty: isShifty,
            base: base,
        }, context.parser.mode);
    },
    htmlBuilder,
    mathmlBuilder,
});

// Text-mode accents
defineFunction({
    type: "accent",
    names: [
        "\\'", "\\`", "\\^", "\\~", "\\=", "\\u", "\\.", '\\"',
        "\\r", "\\H", "\\v", "\\textcircled",
    ],
    props: {
        numArgs: 1,
        allowedInText: true,
        allowedInMath: false,
    },
    handler: (context, args) => {
        const base = args[0];

        return new ParseNode("accent", {
            type: "accent",
            label: context.funcName,
            isStretchy: false,
            isShifty: true,
            base: base,
        }, context.parser.mode);
    },
    htmlBuilder,
    mathmlBuilder,
});