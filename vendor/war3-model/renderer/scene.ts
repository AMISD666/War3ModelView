import { ModelInstance } from './modelInstance';

export class Scene {
    private instances: ModelInstance[] = [];

    public add(instance: ModelInstance): void {
        this.instances.push(instance);
    }

    public remove(instance: ModelInstance): void {
        const index = this.instances.indexOf(instance);
        if (index !== -1) {
            this.instances.splice(index, 1);
        }
    }

    public update(delta: number): void {
        for (const instance of this.instances) {
            instance.update(delta);
        }
    }

    public clear(): void {
        this.instances = [];
    }

    public getInstances(): ModelInstance[] {
        return this.instances;
    }
}
