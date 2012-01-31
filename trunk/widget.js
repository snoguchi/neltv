Hash = function(o) { this.extend(o) };
Hash.prototype = {
  __proto__: Hash.prototype,
  forEach: function(f, o) {
    o = o || this;
    for (var k in this)
      if (this.hasOwnProperty(k))
	f.call(o, k, this[k], this);
  },
  map: function(f, o) {
    var r = [];
    this.forEach(function() { r.push(f.apply(o, arguments)); });
    return r;
  },
  reduce: function(r, f, o) {
    this.forEach(function() {
      Array.unshift(arguments, r); r = f.apply(o, arguments); });
    return r;
  },
  filter: function(f, o) {
    var r = {};
    for (var k in this)
      if (f.apply(o, arguments))
	r[k] = v;
    return r;
  },
  extend: function(o) {
    for (var k in o)
      this[k] = o[k];
    return this;
  },
  query: function() {
    var r = [];
    for (var k in this)
      r.push(k + '=' + escape(this[k]));
    return r.join('&');
  }
};

Function.prototype.__proto__ = {
  bind: function(o) {
    var f = this;
    return function() { return f.apply(o, arguments); };
  },
  bless: (function(g) {
    var seq = 0;
    return function(o) {
      var self = this, name = '__bLs' + seq++;
      var f = eval('(g[name] = function ' + name
        + '() {return self.apply(o, arguments)})');
      f.curse = function() { delete g[name]; };
      return f;
    };
  })(this),
  __noSuchMethod__: function(name, args) {
    return this.prototype[name].apply(args.shift(), args);
  }
};

Array.prototype.__proto__ = {
  __proto__: Hash.prototype,
  invoke: function(name, args) {
    args = args || [];
    return this.map(function(v) { return v[name].apply(v, args); });
  },
  indexOf: function(item) {
    for (var i = 0, n = this.length; i < n; i++)
      if (this[i] === item)
        return i;
    return -1;
  },
  remove: function(item) {
    for (var i = 0, n = this.length; i < n; i++)
      if (this[i] === item)
        this.splice(i, 1);
  },
  get last() {
    return this[this.length - 1];
  }
};

String.prototype.__proto__ = {
  __proto__: Hash.prototype,
  bind: function(o) {
    var f = o[this];
    return function() { return f.apply(o, arguments); };
  },
  fill: function(o) {
    return this.replace(/\#\{(.*?)\}/g, function(_, name) { return o[name]; });
  },
  thaw: function() {
    try { return eval('(' + this + ')'); } catch(e) { return e; }
  },
  get chars() {
    return this.match(/([\x00-\x7f]|[\xc2-\xfd][\x80-\xbf]+)/g);
  }
};

Number.prototype.__proto__ = {
  __proto__: Hash.prototype,
  forEach: function(f, o) {
    for (var i = 0; i < this; i++)
      f.call(o, i, this);
  }
};

XMLDOM.prototype.__proto__ = {
  __proto__: Hash.prototype,
  elem: XMLDOM.prototype.getElementsByTagName,
  attr: XMLDOM.prototype.getAttribute,
  text: function(name) {
    return this.elem(name).join('');
  },
  toString: function() {
    return this.nodeName.charAt(0) == '#'
      ? this.nodeValue : this.childNodes.join('');
  }
};

Observable = function() { this._observers = []; };
Observable.prototype = {
  __proto__: Hash.prototype,
  observe: function(o, caller) {
    var caller = caller || o;
    var list = this._observers;
    var func = typeof o == 'function' ? o.bind(caller)
      : function(type, args) { if (o[type]) o[type].apply(caller, args); };
    list.push(func);
    return function() { list.remove(func); };
  },
  signal: function(type, args) {
    this._observers.forEach(function(f) { f(type, args); });
  }
};

System = {
  event: new Observable,
  input: new Observable
};
'onLoad onFocus onUnfocus onActivate'.split(' ').forEach(function(s) {
  this[s] = function() { System.event.signal(s); };
}, this);
'onConfirmKey onUpKey onDownKey onLeftKey onRightKey onBlueKey onRedKey onGreenKey onYellowKey'.split(' ').forEach(function(s) {
  this[s] = function(type) {
    System.input.signal(s + (type ? 'Released' : 'Pressed'));
    System.input.signal(s, type);
  };
}, this);

Timer = function(reso) {
  this._proxy = this._fire.bless(this);
  this._list = [];
  this._reso = reso || 1000;
};
Timer.prototype = {
  _fire: function() {
    var now = Date.now();
    this._list.sort(function(a, b) { return a.expire - b.expire; });
    while (this._list.length && this._list[0].expire <= now) {
      var id = this._list.shift();
      id.callback();
      if (id.interval) {
        id.expire = now + id.interval;
        this._list.push(id);
      }
    }
    delete this._tid;
    if (this._list.length) {
      this._list.sort(function(a, b) { return a.expire - b.expire; });
      this._schedule(this._list[0].expire);
    }
  },
  _schedule: function(expire) {
    if (this._tid) {
      if (expire >= this._expire)
        return;
      clearTimeout(this._tid);
    }
    var now = Date.now();
    var period = Math.max(1, expire - now);
    period = Math.ceil(period / this._reso) * this._reso;
    this._tid = setTimeout(this._proxy, period);
    this._expire = now + period;
  },
  _add: function(timeout, interval, f, o) {
    var now = Date.now(), exp = now + timeout, self = this;
    var id = {callback:f.bind(o), expire:exp, interval:interval};
    this._list.push(id);
    this._schedule(exp);
    return function() {
      self._list.remove(id);
      delete id.interval; // avoid pendding
    };
  },
  timeout: function(t, f, o) { return this._add(t, 0, f, o); },
  interval: function(t, f, o) { return this._add(t, t, f, o); }
};

System.timer = new Timer;

HTTP = function() {
  Observable.call(this);
  this.xhr = new XMLHttpRequest();
  this.xhr._owner = this;
  this.xhr.onreadystatechange = function() {
    if (this.readyState == 4)
      this._owner._complete();
  };
};
HTTP.prototype = {
  __proto__: Observable.prototype,
  _sentq: [],
  _waitq: [],
  _max: 3,
  _pump: function() {
    while (this._sentq.length < this._max && this._waitq.length > 0) {
      var req = this._waitq.shift();
      this._sentq.push(req);
      req._send();
    }
  },
  _remove: function() {
    this._waitq.remove(this);
    this._sentq.remove(this);
    this.xhr.onreadystatechange = function() {};
  },
  _complete: function() {
    this._remove();
    this.signal(this.success ? 'onSuccess' : 'onFailure', [this.xhr]);
    this.signal('onComplete', [this.xhr]);
    this._pump();
  },
  get success() {
    return this.xhr.status >= 200 && this.xhr.status < 300;
  },
  abort: function() {
    this.xhr.abort();
    this._remove();
    this._pump();
  },
  send: function(body) {
    var xhr = this.xhr;
    this._send = function() { xhr.send(body); };
    this._waitq.push(this);
    this._pump();
  },
  __noSuchMethod__: function(name, args) {
    return this.xhr[name].apply(this.xhr, args);
  }
};

HTTP.get = function(url) {
  var req = new HTTP;
  req.open('GET', url, true);
  req.send(null);
  return req;
};

Node = function(node) {
  Observable.call(this);
  this._node = node;
};
Node.prototype = {
  __proto__: Observable.prototype,
  _call: function(f, args) {
    var ary = [this._node];
    ary.push.apply(ary, args);
    return f.apply(null, ary);
  },
  _set: function(f, k, v) {
    if (this._node[k] != v) f(this._node, (this._node[k] = v)); return v;
  },
  _get: function(f, k) {
    return k in this._node ? this._node[k] : (this._node[k] = f(this._node));
  },
  setStr: function(v) {
    delete this._node.lines;
    this._set(setStr, 'str', v.toString());
  },
  setVisible: function(v) {
    this._set(setVisible, 'visible', v ? 1 : 0);
  },
  loadImage: function() {
    delete this._node.w;
    delete this._node.h;
    this._call(loadImage, arguments);
  },
  child: function(name, klass) {
    var n = new (klass || Node)(getChildNode(this._node, name));
    n.parentNode = this;
    return n;
  },
  set str(v) {
    return this.setStr(v);
  },
  set visible(v) {
    return this.setVisible(v);
  },
  set image(v) {
    return this.loadImage(v);
  },
  show: function() {
    this.setVisible(1);
  },
  hide: function() {
    this.setVisible(0);
  },
  notify: function(type, args) {
    if (this[type])
      this[type].apply(this, args);
    else if (this.parentNode)
      this.parentNode.notify(type, args);
  },
  focus: function() {
    Node.focusNode.onInputBlur();
    Node.focusNode = this;
    this.onInputFocus();
  },
  onInputFocus: function() {},
  onInputBlur: function() {}
};

Hash.forEach({ x:getPosX, y:getPosY, w:getW, h:getH, str:getStr, visible:isVisible, rgb:getRGB, alpha:getAlpha, scaleX:getScaleX, scaleY:getScaleY, name:getName, lines:getLines }, function(k, f) {
  Node.prototype[f.name] = function() { return this._get(f, k); };
  Node.prototype.__defineGetter__(k, function() { return this[f.name](); });
});

Hash.forEach({ x:setPosX, y:setPosY, w:setW, h:setH, /* str:setStr, visible:setVisible, */ rgb:setRGB, alpha:setAlpha, scaleX:setScaleX, scaleY:setScaleY }, function(k, f) {
  Node.prototype[f.name] = function(v) { return this._set(f, k, v); };
  Node.prototype.__defineSetter__(k, function(v) { return this[f.name](v); });
});

[isImageLoaded, destroyImage, pageDown, pageUp, lineDown, lineUp].forEach(function(f) {
  Node.prototype[f.name] = function() { return this._call(f, arguments); };
});

Node.focusNode = new Node(getRootNode());

System.input.observe(function(type, args) {
  Node.focusNode.notify(type, args);
});

Slider = function() { Node.apply(this, arguments); };
Slider.prototype = {
  __proto__: Node.prototype,
  size: 1,
  direction: 'horizontal',
  _traits: {horizontal:{pos:'x', size:'w'}, vertical:{pos:'y', size:'h'}},
  update: function(param) { // size, count, pos
    this.extend(param || {});
    this.size = Math.min(this.size, this.count);
    this.pos = Math.min(this.pos, this.count - this.size);
    var t = this._traits[this.direction];
    var sz1 = this[t.size];
    var sz2 = this.count ? sz1 * this.size / this.count : sz1;
    var step = this.count - this.size;
    var pos = step ? (sz1 - sz2) * (this.pos / step - 0.5) : 0;
    this.thumbNode[t.size] = sz2;
    this.thumbNode[t.pos] = pos;
  }
};

ListBox = function() {
  Node.apply(this, arguments);
  this.frameNode = this;
  this.itemNodes = [];
  this.itemData = [];
};
ListBox.prototype = {
  __proto__: Node.prototype,
  base: 0,
  offset: 0,
  get selectedIndex() {
    return this.base + this.offset;
  },
  get selectedData() {
    return this.itemData[this.selectedIndex];
  },
  get selectedNode() {
    return this.itemNodes[this.selectedIndex % this.itemNodes.length];
  },
  get hasNext() {
    return this.selectedIndex < this.itemData.length - 1;
  },
  get hasPrev() {
    return this.selectedIndex > 0;
  },
  update: function(param) {
    this.extend(param || {});
    var top = 0;
    this.frameNode.hide();
    this.itemNodes.forEach(function(node, i) {
      var data = this.itemData[this.base + i];
      if (data) {
	this.onDrawItem(node, data);
	node.y = top + node.h / 2;
	top += node.h;
	node.show();
      } else {
	node.hide();
      }
    }, this);
    this.frameNode.y = - this.frameNode.h / 2;
    this._adjust();
    this.frameNode.show();
    this.onSelectItem(this.selectedNode, this.selectedData);
  },
  _adjust: function() {
    var fn = this.frameNode, sn = this.selectedNode;
    if (fn.y + sn.y - sn.h / 2 < - fn.h / 2) // top
      fn.y = - sn.y - (fn.h - sn.h) / 2;
    else if (fn.y + sn.y + sn.h / 2 > fn.h / 2) // bottom
      fn.y = - sn.y + (fn.h - sn.h) / 2;
  },
  next: function() {
    if (this.hasNext) {
      if (this.offset < this.itemNodes.length - 1) {
	this.offset++;
      } else {
	var node = this.selectedNode;
	this.base++;
	this.onDrawItem(this.selectedNode, this.selectedData);
	this.selectedNode.y = node.y + (node.h + this.selectedNode.h) / 2;
      }
      this._adjust();
      this.onSelectItem(this.selectedNode, this.selectedData);
    }
  },
  prev: function() {
    if (this.hasPrev) {
      if (this.offset > 0) {
	this.offset--;
      } else {
	var node = this.selectedNode;
	this.base--;
	this.onDrawItem(this.selectedNode, this.selectedData);
	this.selectedNode.y = node.y - (node.h + this.selectedNode.h) / 2;
      }
      this._adjust();
      this.onSelectItem(this.selectedNode, this.selectedData);
    }
  },
  onDrawItem: function() {},
  onSelectItem: function() {}
};


String.prototype.escapeHTML = function() {
  return this.replace(/<br>/g, '\n').replace(/<[^>]*>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
};

String.use_sjis = function(f) {
  var req = HTTP.get('sjis2utf8.xml');

  req.observe({
    onSuccess: function(xhr) {
      String.SJIS2UTF8 = xhr.responseXML.elem('r').map(function(r) { return r.elem('c'); });
      f();
    }
  });

  String.prototype.sjis2utf8 = function() {
    var out = [], tmp = 0;
    this.split('').forEach(function(c) { // use forEach instead replace
      var code = c.charCodeAt(0);
      if (tmp) {
	try { out.push(String.SJIS2UTF8[tmp][code-0x40].firstChild.nodeValue); } catch(e) {}
        tmp = 0;
      } else if (0xa1 <= code && code <= 0xdf) {
        try { out.push(String.SJIS2UTF8[0][code-0x40].firstChild.nodeValue); } catch(e) {}
      } else if ((0x81 <= code && code <= 0x9f) || (0xe0 <= code && code <= 0xfc)) {
        tmp = code;
      } else {
        out.push(c);
      }
    });
    return out.join('');
  };

  return req;
};

App = {};

App.SubjectData = function(url) {
  Observable.call(this);
  this._url = url;
};
App.SubjectData.prototype = {
  __proto__: Observable.prototype,
  get url() { return this._url + '?' + Date.now(); },
  interval: 10000,
  start: function() {
    if (this.request)
      return;
    if (this.timer)
      this.timer();
    this.request = HTTP.get(this.url);
    this.request.deleteObserver = this.request.observe(this);
  },
  stop: function() {
    if (this.request) {
      this.request.abort();
      this.request.deleteObserver();
      delete this.request;
    }
    if (this.timer) {
      this.timer();
      delete this.timer;
    }
  },
  onComplete: function(xhr) {
    delete this.request;
    this.timer = System.timer.timeout(this.interval, 'start', this);
  },
  onSuccess: function(xhr) {
    var now = Date.now();
    var items = xhr.responseText.sjis2utf8().split('\n').reduce([], function(r, line) {
      var m = line.match(/^(\d+)\.dat\<\>(.*)\((\d+)\)/);
      if (m) {
        var id = parseInt(m[1]);
        var res = parseInt(m[3]);
        var ctime = new Date(id * 1000);
        if (res <= 1000)
          r.push({id:id, title:m[2], res:res, ctime:ctime});
      }
      return r;
    });
    this.signal('onSubjectItems', [items]);
  },
  onFailure: function(xhr) {
    print('failed to load subject (' + xhr.status + ')');
  }
};

App.DatParser = function(max) {
  this._tail = { lines:[] };
  this.count = 0;
  this.max = max || 20;
};
App.DatParser.prototype = {
  _remain: '',
  add: function(text) {
    var lines = (this._remain + text).split('\n');
    this._remain = lines.pop();

    if (this.count == 0)
      this._first = lines[0];

    this.count += lines.length;
    this._tail = { lines:this._tail.lines.concat(lines).splice(- this.max) };
  },
  clear: function() {
    this._tail = { lines:[] };
  },
  get title() {
    return this._first.sjis2utf8().split('<>').pop().escapeHTML();
  },
  get tail() {
    var from = this.count - this._tail.lines.length + 1;
    return this._tail.parsed
      || (this._tail.parsed = this._tail.lines.map(function(line) {
        var t = line.sjis2utf8().split('<>');
        var name = (t[0] || '').replace(/<.*?>/g, '');
        var text = (t[3] || '').escapeHTML();
        return { name:name, mail:t[1], date:t[2], text:text, index:from++ };
      }));
  }
};

App.DatStream = function(url) {
  Observable.call(this);
  this.url = url;
  this.parser = new App.DatParser(10);
  this._offset = 0;
  this._init();
};
App.DatStream.prototype = {
  __proto__: Observable.prototype,
  _bufsize: 15 * 1024,
  interval: 5000,
  _init: function() {
    var req = new HTTP;
    req.open('GET', this.url, true);
    if (this.lastModified)
      req.setRequestHeader('If-Modified-Since', this.lastModified);
    req.setRequestHeader('Range', 'bytes=' + this._offset + '-' + (this._offset + this._bufsize - 1));
    req.observe({
      onSuccess: function(xhr) {
	//print(xhr.getResponseHeader('Content-Length') + ', ' + xhr.getResponseHeader('Content-Range'));
        var m = (xhr.getResponseHeader('Content-Range') || '').match(/(\d+)\-(\d+)\/(\d+)/);
        var from = parseInt(m[1]), to = parseInt(m[2]), total = parseInt(m[3]);
	var len = parseInt(xhr.getResponseHeader('Content-Length'));

	if (to - from + 1 !== len) {
	  print('invalid header');
	  System.timer.timeout(this.interval, '_init', this);
	  return;
	}

        this._offset += xhr.responseText.length;
        this.parser.add(xhr.responseText);

	if (from == 0)
	  this.signal('onDatTitle', [this.parser.title]);
        if (to + 1 == total) {
          this.lastModified = xhr.getResponseHeader('Last-Modified');
          this.signal('onDatItems', [this.parser.tail]);
          if (this.parser.tail.last.index > 1000) {
            this.signal('onDatFinished');
          } else {
            this.parser.clear();
            System.timer.timeout(this.interval, '_init', this);
          }
        } else {
          this.signal('onDatLoading', [from, to, total]);
          this._init();
        }
      },
      onFailure: function(xhr) {
	print('failed to load dat (' + xhr.status + ')');
	System.timer.timeout(this.interval, '_init', this);
      }
    }, this);
    req.send(null);
  }
};


App.BufferedStream = function(url) {
  Observable.call(this);
  this.stream = new App.DatStream(url);
  this.stream.observe(this);
  this.url = url;
  this.items = [];
  System.timer.interval(this.interval, 'update', this);
};
App.BufferedStream.prototype = {
  __proto__: Observable.prototype,
  interval: 2000,
  onDatTitle: function(title) {
    this.signal('onDatTitle', [title]);
  },
  onDatItems: function(items) {
    this.signal('onDatItems', [this.items]);
    this.steps = Math.ceil(items.length * this.interval / this.stream.interval);
    this.items = items;
  },
  onDatLoading: function() {
    this.signal('onDatLoading', arguments);
  },
  update: function() {
    if (this.items.length > 0) {
      var items = this.items.splice(0, this.steps);
      this.signal('onDatItems', [items]);
      if (items.last.index > 1000)
	this.signal('onDatFinished', arguments);
    }
  }
};

App.SubjectView = function() {
  ListBox.apply(this, arguments);
  this.itemNodes = (7).map(function(i) {
    return this.child('text' + i);
  }, this);
  this.frameNode = this.child('frame');
  this.selectorNode = this.child('selector');
  this.child('logo').loadImage('img/logo.png');
  this.child('banner').loadImage('http://ctlaltdel.net/neltv/banner/sv.png')
};
App.SubjectView.prototype = {
  __proto__: ListBox.prototype,
  onInputFocus: function() {
    this.selectorNode.show();
    this.update();
  },
  onInputBlur: function() {
    this.selectorNode.hide();
    this.update();
  },
  onDrawItem: function(node, data) {
    if (node) {
      if (data && data.title) {
        node.str = data.title.replace('res/min', '');
      } else {
        node.str = '';
      }
    }
  },
  onSelectItem: function(node, data) {
    this.selectorNode.y = node.y;
  },
  onUpKeyPressed: function() {
    this.prev();
  },
  onDownKeyPressed: function() {
    this.next();
  }
};


App.DatItem = function() {
  Node.apply(this, arguments);
  this.bg = this.child('bg');
  this.nick = this.child('nick');
  this.nick.lineHeight = 12 + 4;
  this.text = this.child('text');
  this.text.lineHeight = 14 + 4;
};
App.DatItem.prototype = {
  __proto__: Node.prototype,
  padding: 3,
  activate: function() {
    this.text.rgb = '0000ff';
  },
  inactivate: function() {
    this.text.rgb = '000000';
  },
  spacingV: 2,
  update: function(item) {
    this.nick.str = '#{index} : #{name}'.fill(item);
    this.nick.h   = this.nick.lineHeight * this.nick.lines;
    this.text.str = item.text;
    this.text.h   = this.text.lineHeight * this.text.lines;
    this.h = this.bg.h = this.text.h + this.nick.h + this.padding;
    this.nick.y   = this.padding + this.h / -2;
    this.text.y   = this.nick.y + this.nick.h;
  }
};

App.DatList = function() {
  Node.apply(this, arguments);
  this.childNodes = [];
  this.itemNodes = (20).map(function(i) {
    return this.child('item' + i, App.DatItem);
  }, this);
  this.y = this.h / -2;
};
App.DatList.prototype = {
  __proto__: Node.prototype,
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1];
  },
  shiftChild: function() {
    var node = this.itemNodes.shift() || this.childNodes.shift();
    node.hide();
    return node;
  },
  pushChild: function(node) {
    var last = this.lastChild;
    var top = last ? last.y + last.h / 2 : 0;
    node.y = (top + node.h / 2);
    this.childNodes.push(node);
  },
  append: function(items) {
    this.childNodes.forEach(function(node) { node.inactivate(); });
    items.forEach(function(item, i) {
      var node = this.shiftChild();
      node.update(item);
      node.activate();
      this.pushChild(node);
    }, this);
    this.scrollToLast();
  },
  scrollToLast: function() {
    var last = this.lastChild;
    if (last.y + last.h / 2 > this.h)
      this.y = - last.y + (this.h - last.h) / 2;
    this.childNodes.forEach(function(node) { node.show(); }, this);
  }
};

App.LoadingIcon = function() {
  Node.apply(this, arguments);
  this._index = 0;
  this._iconNodes = (8).map(function(i) {
    var icon = this.child('icon' + i);
    icon.loadImage('img/loading' + i + '.png');
    icon.hide();
    return icon;
  }, this);
};
App.LoadingIcon.prototype = {
  __proto__: Node.prototype,
  start: function() {
    if (this._cancel) return;
    this._update();
    this._cancel = System.timer.interval(1000, '_update', this);
  },
  stop: function() {
    if (this._cancel) {
      this._cancel();
      delete this._cancel;
    }
  },
  _update: function() {
    this._iconNodes.forEach(function(item, i) {
      item.visible = i == this._index;
    }, this);
    this._index = (this._index + 1) % this._iconNodes.length;
  }
}


App.DatView = function() {
  Node.apply(this, arguments);
  this.listNode  = this.child('list', App.DatList);
  this.titleNode = this.child('title');
  this.progressNode = this.child('progress', Slider);
  this.progressNode.thumbNode = this.progressNode.child('thumb');
  this.loadingNode = this.child('loading', App.LoadingIcon);
  this.child('logo').loadImage('img/logo.png');
  this.child('banner').loadImage('http://ctlaltdel.net/neltv/banner/dv.png');
};
App.DatView.prototype = {
  __proto__: Node.prototype,
  setTitle: function(title) {
    this.titleNode.str = title;
  },
  setProgress: function(from, to, len) {
    this.loadingNode.start();
    this.loadingNode.show();
    this.progressNode.update({pos:0, size:to, count:len});
    this.progressNode.show();
  },
  setItems: function(items) {
    if (this.progressNode.visible) {
      this.progressNode.update({pos:0, size:1, count:1});
      this.loadingNode.stop();
      System.timer.timeout(1000, function() {
	this.loadingNode.hide();
	this.progressNode.hide();
      }, this);
    }

    if (items.length > 0)
      this.listNode.append(items);
  }
};


App.Controller = function() {
  Node.call(this, getRootNode());
};
App.Controller.prototype = {
  __proto__: Node.prototype,
  onLoad: function() {
    System.event.observe(this);
    this.subjectView = this.child('subject-view', App.SubjectView);
    this.subjectData = new App.SubjectData('http://epg.2ch.net/tv2chwiki/subject.txt');
    this.subjectData.observe(this);
    this.subjectData.start();
  },
  onFocus: function() {
    this.subjectView.focus();
  },
  onUnfocus: function() {
    this.focus();
  },
  onActivate: function() {
    this.datView = this.child('dat-view', App.DatView);
    this.datView.show();
    this.datView.focus();
    this.datView.setProgress(0, 0, 1);
    this.loadDat();
  },
  loadDat: function() {
    HTTP.get('http://epg.2ch.net/tv2chwiki/dat/' + this.subjectView.selectedData.id + '.dat').observe({
      onSuccess: function(xhr) {
        var url = xhr.responseText.sjis2utf8().split('\n').shift().split('<>')[3].split('<br>')[4].replace(/^.*(http:\/\/[^/]+)\/test\/read\.cgi\/([^/]+)\/(\d+)\//, '$1/$2/dat/$3.dat');
	if (!this.datStream || this.datStream.url != url) {
	  this.subjectData.stop();
          this.datStream = new App.BufferedStream(url);
          this.datStream.observe(this);
	}
      }
    }, this);
  },
  onSubjectItems: function(items) {
    this.subjectView.update({itemData:items});
    if (this.datView)
      this.loadDat();
  },
  onDatTitle: function(title) {
    this.datView.setTitle(title);
  },
  onDatItems: function(items) {
    this.datView.setItems(items);
  },
  onDatLoading: function(from, to, len) {
    this.datView.setProgress(from, to, len);
  },
  onDatFinished: function() {
    this.subjectData.start();
    this.datView.setProgress(0, 0, 1);
  }
};

String.use_sjis(function() {
  app = new App.Controller;
  app.onLoad();
});
