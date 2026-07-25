export class Holder<T> {
    value!: T;
    set: (val: T) => void = (val: T) => {
        this.value = val;
    }
}