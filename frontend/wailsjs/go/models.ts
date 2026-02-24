export namespace health {
	
	export class Item {
	    name: string;
	    ok: boolean;
	    severity: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ok = source["ok"];
	        this.severity = source["severity"];
	        this.message = source["message"];
	    }
	}
	export class Report {
	    ready: boolean;
	    // Go type: time
	    checkedAt: any;
	    items: Item[];
	
	    static createFrom(source: any = {}) {
	        return new Report(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ready = source["ready"];
	        this.checkedAt = this.convertValues(source["checkedAt"], null);
	        this.items = this.convertValues(source["items"], Item);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class AppPaths {
	    saveGamePath: string;
	    profilesPath: string;
	
	    static createFrom(source: any = {}) {
	        return new AppPaths(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.saveGamePath = source["saveGamePath"];
	        this.profilesPath = source["profilesPath"];
	    }
	}
	export class ProfileItem {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}

}

export namespace switcher {
	
	export class Result {
	    ProfileName: string;
	    // Go type: time
	    SwitchedAt: any;
	    RolledBack: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ProfileName = source["ProfileName"];
	        this.SwitchedAt = this.convertValues(source["SwitchedAt"], null);
	        this.RolledBack = source["RolledBack"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

