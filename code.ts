/**
 * According to Figma API docs overrides support:
 * - colours;
 * - text styles;
 * - and effects.
 *
 * @see https://help.figma.com/article/306-using-instances#override
 */

type ChildrenContainer = InstanceNode | FrameNode
type ApplicableNode = ChildrenContainer | TextNode

interface CopyDirection {
    source: ApplicableNode,
    dest: ApplicableNode,
}

const effectsProps = ['effectStyleId', 'effects'];
const colorProps = [
    'backgroundStyleId',
    'backgrounds',
    'opacity',
    'fills',
    'strokes',
    'strokeWeight',
    'strokeAlign',
    'strokeCap',
    'strokeJoin',
    'dashPattern',
    'fillStyleId',
    'strokeStyleId',
];

const textContentsProps = ['characters'];
const fontStyleProps = [
    'fillStyleId',
    'fills',
    'textAlignHorizontal',
    'textAlignVertical',
    'textAutoResize',
    'paragraphIndent',
    'paragraphSpacing',
    'textStyleId',
    'fontSize',
    'fontName',
    'textCase',
    'textDecoration',
    'letterSpacing',
    'lineHeight',
];


function hasChildren(node) {
    return !!node && !!node.children && !!node.children.length;
}

function clone(val) {
    return JSON.parse(JSON.stringify(val));
}

const createPropsCloner = ({source, dest}: CopyDirection) => (props: string[]) => {
    if (!source || !dest) return;

    props.forEach(prop => {
        if (!source[prop]) return;
        dest[prop] = clone(source[prop]);
    });
}


function extractFontName(node) {
    const fontsList = [];

    if (node.type === 'TEXT') {
        fontsList.push(node.fontName);
    }

    if (hasChildren(node)) {
        node.children.forEach(child => {
            fontsList.push(...extractFontName(child));
        });
    }

    return fontsList;
}

function loadFonts(node) {
    return Promise.all(extractFontName(node).map(fontName => {
        return figma.loadFontAsync(fontName);
    }));
}

function copyOverrides({source, dest}: CopyDirection) {
    const cloneProps = createPropsCloner({ source, dest });
    cloneProps(effectsProps);
    cloneProps(colorProps);

    if (dest.type === 'TEXT' && source.type === 'TEXT') {
        cloneProps(fontStyleProps);
        cloneProps(textContentsProps);
        return;
    }

    if (!hasChildren(source) || !hasChildren(dest)) {
        return;
    }

    (source as ChildrenContainer).children.forEach((sourceChild, index) => {
        const destChild = (dest as ChildrenContainer).children[index];
        if (!sourceChild || !destChild) return;

        copyOverrides({
            source: sourceChild as ApplicableNode,
            dest: destChild as ApplicableNode
        });
    });
}

async function tryCopyOverrides(frame, instanceClone) {
    try {
        // need to load fonts first, otherwise it won't apply font styles
        await loadFonts(frame);
        await loadFonts(instanceClone);

        copyOverrides({
            source: frame,
            dest: instanceClone,
        });
    }
    catch(e) {
        console.error(e);
        return `Couldn't copy overrides from [${frame.name}] to [${instanceClone.name}]. See console logs for more info.`;
    }
}


async function reattachInstance() {
    let skippedCount = 0;
    let processedCount = 0;
    let originalInstances = {};

    if (figma.currentPage.selection.length == 0) {
        return "Please, select a frame first";
    }

    const clonedSelection = Object.assign([], figma.currentPage.selection);

    for (let index in clonedSelection) {
        let frame = clonedSelection[index];
        let instanceReference;

        if (frame.type !== "FRAME") {
          skippedCount += 1;
          continue;
        }

        if (!(frame.name in originalInstances)) {
            instanceReference= figma.currentPage.findOne(node => node.type === "INSTANCE" && node.name == frame.name) as InstanceNode;
            originalInstances[frame.name] = instanceReference;
        } else {
            instanceReference = originalInstances[frame.name];
        }

        if (instanceReference != null) {
            let instanceClone = instanceReference.masterComponent.createInstance();
            frame.parent.appendChild(instanceClone);
            instanceClone.x = frame.x;
            instanceClone.y = frame.y;
            instanceClone.resize(frame.width, frame.height);

            if (figma.command === 'saveOverrides') {
                await tryCopyOverrides(frame, instanceClone);
            }

            frame.remove();
            processedCount += 1;
            continue;
        }
        skippedCount += 1;
        continue;
    }

    return `${processedCount} processed, ${skippedCount} skipped`;
}

(async () => {
    figma.closePlugin(await reattachInstance());
})();
