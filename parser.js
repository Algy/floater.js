"use strict";

var fs = require("fs");

function StringStream(str) {
    this.str = str;
    this.idx = 0;

    this.line = 1;
    this.col = 1;

    this.positionStack = [];
}

function isWhitespace(s) {
    return s === ' ' || s === '\n' || s === '\t';
}

StringStream.prototype = {
    pop: function () {
        if (this.idx < this.str.length) {
            var c = this.str[this.idx++];
            if (c === '\n') {
                this.line++;
                this.col = 1;
            } else {
                this.col++;
            }
            return c;
        } else {
            return undefined;
        }
    },
    popn: function (n) {
        var result = this.str.substring(this.idx, this.idx + n);
        if (this.idx + n > this.str.length) {
            this.idx = this.str.length;
        } else {
            this.idx += n;
        }
        for (var t = 0; t < result.length; t++) {
            if (result[t] === '\n') {
                this.line++;
                this.col = 1;
            } else {
                this.col++;
            }
        }
        return result;
    },
    peek: function () {
        return this.str[this.idx];
    },
    isPrefixed: function (prefix) {
        if (this.str.length - this.idx < prefix.length)
            return false;
        for (var t = 0; t < prefix.length; t++) {
            if (this.str.charCodeAt(this.idx + t) !== prefix.charCodeAt(t)) {
                return false;
            }
        }
        return true;
    },
    remember: function () {
        this.positionStack.push(this.idx);
    },
    recall: function () {
        return this.str.substring(this.positionStack.pop(), this.idx);
    },
    isEOF: function () {
        return this.idx >= this.str.length;
    },
    skipWhitespace: function () {
        while (this.idx < this.str.length && isWhitespace(this.str[this.idx])) {
            if (this.str[this.idx++] === '\n') {
                this.col = 1;
                this.line++;
            } else {
                this.col++;
            }
        }
    },
    skipTo: function (s) {
        while (this.idx < this.str.length) {
            if (typeof s === 'string') {
                for (var t = 0; t < s.length; t++) {
                    if (this.str.charCodeAt(this.idx) === s.charCodeAt(t)) {
                        return true;
                    }
                }
            } else if (Array.isArray(s)) {
                for (var t = 0; t < s.length; t++) {
                    if (this.isPrefixed(s[t]))
                        return true;
                }
            }

            if (this.str[this.idx++] === '\n') {
                this.col = 1;
                this.line++;
            } else {
                this.col++;
            }
        }
        return false;
    }
};

var _VOID_TAG_SET = {
    br: true,
    hr: true,
    img: true,
    input: true,
    link: true,
    meta: true,
    area: true,
    base: true,
    col: true,
    embed: true,
    keygen: true,
    menuitem: true,
    param: true,
    source: true,
    track: true,
    wbr: true
};

var _TEMPLATE_TAG_PAIRS = [
    ["{{", "}}"],
    ["{%", "%}"],
    ["{#", "#}"],
    ["<%", "%>"],
    ["<?php", "?>"],
    ["<?", "?>"]
];

var tplTagStArray = [];
for (var t = 0; t < _TEMPLATE_TAG_PAIRS.length; t++) {
    tplTagStArray.push(_TEMPLATE_TAG_PAIRS[t][0]);
}

function parseStream(stringStream, depth) {
    var result = [];
    if (depth === undefined)
        depth = 0;

    function makeNode(type, locinfo, raw, content, attrs, children) {
        return {
            type: type,
            locinfo: locinfo,
            raw: raw || "",
            content: content || "",
            attrs: attrs || [],
            children: children || []
        };
    }

    function yieldNode(type, locinfo, raw, content, attrs, children) {
        result.push(makeNode(type, locinfo, raw, content, attrs, children));
    }

    function skipToTemplate() {
        var s = tplTagStArray.slice();
        for (var t = 0; t < arguments.length; t++) {
            s.push(arguments[t]);
        }
        return stringStream.skipTo(s);
    }

    function consumeTemplate() {
        for (var t = 0; t < _TEMPLATE_TAG_PAIRS.length; t++) {
            var se = _TEMPLATE_TAG_PAIRS[t];
            var tagSt = se[0];
            var tagEd = se[1];
            if (stringStream.isPrefixed(tagSt)) {
                var lineSt = stringStream.line;
                var colSt = stringStream.col;

                stringStream.remember();
                stringStream.popn(tagSt.length);

                var error = true;
                while (!stringStream.isEOF()) {
                    stringStream.skipTo(["'", '"', tagEd]);
                    if (stringStream.isEOF()) {
                        break;
                    }
                    if (stringStream.isPrefixed(tagEd)) {
                        stringStream.popn(tagEd.length);
                        error = false;
                        break;
                    } else {
                        var quot = stringStream.pop();
                        stringStream.skipTo([quot]);
                        stringStream.pop(); // consume quot
                    }
                }
                var raw = stringStream.recall();
                if (error) {
                    throw "parseerror";
                }
                return makeNode("template",
                    {line: [lineSt, stringStream.line], col: [colSt, stringStream.col - 1]},
                    raw,
                    raw);
            }
        }
        return undefined;
    }
    var lineSt;
    var colSt;
    function buildLocinfo (line_, col_) {
        return {line: [line_ || lineSt, stringStream.line], col: [col_ || colSt, stringStream.col - 1]};
    }

    while (!stringStream.isEOF()) {
        if (stringStream.isPrefixed('</')) {
            if (depth > 0)
                break;
            else {
                throw "parseerror";
            }
        }
        var temp;
        if ((temp = consumeTemplate()) !== undefined) {
            result.push(temp);
            continue;
        }

        lineSt = stringStream.line;
        colSt = stringStream.col;

        stringStream.remember();
        var c = stringStream.peek();
        if (c === '<') {
            stringStream.pop();
            if (stringStream.isPrefixed('!--')) {
                stringStream.popn(3);
                stringStream.remember();
                stringStream.skipTo(["-->"]);
                if (stringStream.isEOF()) {
                    throw "parseerror";
                }
                var comment = stringStream.recall();
                stringStream.popn(3);
                var raw = stringStream.recall();

                yieldNode("comment",
                    buildLocinfo(),
                    raw,
                    comment);
                continue;
            } else if (stringStream.peek() === '!') {
                stringStream.pop();
                stringStream.remember();
                stringStream.skipTo(">");
                if (stringStream.isEOF()) {
                    throw "parseerror";
                }
                var declaration = stringStream.recall();
                stringStream.pop();
                var raw = stringStream.recall();
                yieldNode("declaration",
                    buildLocinfo(),
                    raw,
                    declaration);
                continue;
            }
            stringStream.remember();
            stringStream.skipTo(" \t\n/>");
            var tagName = stringStream.recall();
            var attrs = [];

            stringStream.skipWhitespace();
            while (!stringStream.isEOF() && stringStream.peek() !== '/' &&  stringStream.peek() !== '>') {
                var temp;
                if ((temp = consumeTemplate()) !== undefined) {
                    attrs.push({attrType: 'template', node: temp});
                } else {
                    stringStream.remember();
                    stringStream.skipTo(" \t\n=/>");
                    var attrKey = stringStream.recall();
                    stringStream.skipWhitespace();

                    var attrValue;
                    var quot = undefined;
                    if (stringStream.peek() === '=') {
                        stringStream.pop();
                        stringStream.skipWhitespace();
                        if (stringStream.peek() === "'" || stringStream.peek() === '"') {
                            quot = stringStream.pop();
                            stringStream.remember();
                            while (!stringStream.isEOF() && stringStream.peek() !== quot) {
                                consumeTemplate();
                                if (stringStream.peek() === quot) {
                                    break;
                                }
                                stringStream.pop();
                            }
                            if (stringStream.isEOF()) {
                                throw "parseerror";
                            }
                            attrValue = stringStream.recall();
                            stringStream.pop(); // consume quot
                        } else {
                            stringStream.remember();
                            while (!stringStream.isEOF() && !isWhitespace(stringStream.peek()) && stringStream.peek() !== '/' && stringStream.peek() !== '>') {
                                consumeTemplate();
                                if (isWhitespace(stringStream.peek()) || stringStream.peek() === '/' || stringStream.peek() === '>') {
                                    break;
                                }
                                stringStream.pop();
                            }
                            attrValue = stringStream.recall();
                        }
                    } else {
                        attrValue = undefined;
                    }
                    attrs.push({attrType: "keyvalue", key: attrKey, value: attrValue, quot: quot});
                }
                stringStream.skipWhitespace();
            }
            
            if (stringStream.peek() === '/') {
                stringStream.pop();
            }

            if (stringStream.peek() !== '>') {
                throw "parseerror: got " + stringStream.peek() + " " + stringStream.line;
            }
            stringStream.pop();

            var children;
            if (tagName.toLowerCase() in _VOID_TAG_SET) {
                children = [];
            } else {
                children = parseStream(stringStream, depth + 1);
                if (!stringStream.isPrefixed("</")) {
                    throw "parseerror";
                }
                stringStream.popn(2);

                stringStream.remember();
                stringStream.skipTo(" \n\t>");
                var endTagName = stringStream.recall();

                if (tagName !== endTagName) {
                    throw "parseerror: <" + tagName + "> !== </" + endTagName + ">, " + stringStream.line + ":" + stringStream.col;
                }

                stringStream.skipWhitespace();
                if (stringStream.peek() !== '>') {
                    throw "parseerror";
                }
                stringStream.pop();
            }
            var raw = stringStream.recall();
            yieldNode("tag",
                buildLocinfo(),
                raw,
                tagName,
                attrs,
                children);
        } else if (c === '>') {
            throw "parseerror";
        } else {
            stringStream.recall();

            while (!stringStream.isEOF()) {
                var curLine = stringStream.line, curCol = stringStream.col;

                stringStream.remember();
                skipToTemplate("<", ">");
                var text = stringStream.recall();
                if (text) {
                    yieldNode("text",
                        buildLocinfo(curLine, curCol),
                        text,
                        text);
                }

                var temp = consumeTemplate();
                if (temp !== undefined) {
                    result.push(temp);
                } else {
                    break;
                }
            }
        }
    }
    return result;
}

var _ATTR_FUNC = {
};

var _DUMP_FUNC = {
    template: function (node, arr) { arr.push(node.content);
    },
    comment: function (node, arr) {
        arr.push("<!--");
        arr.push(node.content);
        arr.push("-->");
    },
    declaration: function (node, arr) {
        arr.push("<!");
        arr.push(node.content);
        arr.push(">");
    },
    tag: function (node, arr) {
        var tagName = node.content;
        arr.push("<");
        arr.push(tagName);

        for (var idx = 0; idx < node.attrs.length; idx++) {
            var attr = node.attrs[idx];
            var attrType = attr.attrType;

            arr.push(' ');
            if (attrType === 'template') {
                arr.push(attr.node.content);
            } else if (attrType === 'keyvalue') {
                var quot = attr.quot;
                arr.push(attr.key);
                if (attr.value !== undefined) {
                    arr.push('=');
                    if (quot) {
                        arr.push(quot);
                    }
                    arr.push(attr.value);
                    if (quot) {
                        arr.push(quot);
                    }
                }
            } else {
                throw "NOT REACHABLE";
            }
        }
        arr.push(">");
        if (!(tagName.toLowerCase() in _VOID_TAG_SET)) {
            dumpNodes(node.children, arr);
            arr.push("</" + tagName + ">");
        }
    },
    text: function (node, arr) {
        arr.push(node.content);
    }
}; 

function dumpNodes(nodes, arr) {
    for (var idx = 0; idx < nodes.length; idx++) {
        var node = nodes[idx];
        var type = node.type;
        _DUMP_FUNC[type](node, arr);
    }
    return arr;
}

function dumpNodesWrapper(nodes) {
    var arr = [];
    dumpNodes(nodes, arr);
    return arr.join("");
}

var _ALLOWED_ATTRIBUTES = [
    {name: "float-items", domain: ['left', 'right', 'center', 'top', 'middle', 'bottom', 'space-between', 'space-around']},
    {name: "align-items", domain: ['left', 'right', 'center', 'top', 'middle', 'bottom']},
    {name: 'margin-between-items', measurement: true},
    {name: 'wrap-items', domain: ['wrap', 'nowrap']},
    {name: 'as-conatiner', measurement: 'fixed'},

    {name: 'margin', measurement: true},
    {name: 'margin-top', measurement: true},
    {name: 'margin-bottom', measurement: true},
    {name: 'margin-left', measurement: true},
    {name: 'margin-right', measurement: true},

    {name: 'padding', measurement: true},
    {name: 'padding-top', measurement: true},
    {name: 'padding-bottom', measurement: true},
    {name: 'padding-left', measurement: true},
    {name: 'padding-right', measurement: true},

    {name: "max-width", measurement: true},
    {name: "min-width", measurement: true},
    {name: "width", measurement: true, domain: ['match-parent', 'wrap-content', 'fill-remaining-space']},
    {name: "height", measurement: true, domain: ['match-parent', 'wrap-content']},
    {name: "use-class"},
    {name: "max-height", measurement: true},
    {name: "min-height", measurement: true},
    {name: "virtual", domain: 'bool'}
];

/*
 *
 */
function Floater() {
    this.src = undefined;
}
Floater.prototype.parse = function (src) {
    var stream = new StringStream(src);
    this.nodes = parseStream(stream);

    return this;
};

Floater.prototype.translate = function () {
};

Floater.prototype.getHTML = function () {
};

Floater.prototype.getCSS = function () {
};

var doc = fs.readFileSync("test.html", "utf-8");
var floater = new Floater();
floater.parse(doc);
console.log(dumpNodesWrapper(floater.nodes));
