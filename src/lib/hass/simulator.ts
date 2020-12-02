import { HassObject, HassEntity } from './hass';
import { ServiceCallRequest, ServiceCallResponse } from './frontend-types';

export class SimulatorConfig {
  simulations = new Array<Simulation>();
}

export class Simulation {
  entity!: HassEntity;
  states = new Array<TimedHassEntity>();
  enabled = true;
}

export class TimedHassEntity extends HassEntity {
  duration = 0;
}

export class Simulator {
  simulationProcessors = new Array<SimulationProcessor>();
  hass!: HassObject;

  constructor(simulatorConfig: SimulatorConfig, private hassChanged: (hass: HassObject) => void) {
    const hass = new HassObject();
    hass.callService = this.callService.bind(this);
  
    for (const simulation of simulatorConfig.simulations) {
      const simulationProcessor = new SimulationProcessor(simulation, this.hass, this.onEntityStatesChanged.bind(this));
      this.simulationProcessors.push(simulationProcessor);
    }
  }

  onEntityStatesChanged(entityStates: Array<HassEntity>): void {
    for (const entityState of entityStates) {
      this.hass.states[entityState.entity_id] = entityState;
    }

    this.hassChanged(this.hass.clone()); // clone the object!!!
  }

  callService(
    domain: ServiceCallRequest["domain"],
    service: ServiceCallRequest["service"],
    serviceData?: ServiceCallRequest["serviceData"]
  ): Promise<ServiceCallResponse> {
    console.log('callService', domain, service, serviceData);

    switch (domain) {
      case 'homeassistant':
        switch (service) {
          case 'toggle':
            this.homeAssistantToggle(serviceData as Record<string, unknown>);
            break;
        }
        break;
    }

    const response = {
      context: {
        id: '',
        parent_id: undefined,
        user_id: undefined,
      }
    } as ServiceCallResponse;

    return Promise.resolve(response);
  }

  homeAssistantToggle(data: Record<string, unknown>): void {
    if (data.entity_id) {
      const entityType = (data.entity_id as string).split('.')[0];
      const state = this.hass.states[data.entity_id as string].state;

      let newState: string;

      switch (entityType) {
        case 'switch':
        case 'light':
          newState = (state === 'on') ? 'off' : 'on';

          for (const simulationProcessor of this.simulationProcessors) {
            simulationProcessor.updateEntityState(data.entity_id as string, newState);
          }
          break;
      }
    }
  }
}

export class SimulationProcessor {
  currentIndex = 0;

  constructor(private simulation: Simulation, private hass: HassObject, private onEntityStatesChanged: (entityStates: Array<HassEntity>) => void) {
    if (!this.simulation.entity) {
      console.error('Simulation must contain an entity', simulation);
    }

    if (!this.simulation.states.length) {
      console.error('Simulation must contain at least one state', simulation);
    }

    this.triggerState(this.simulation.states[0]);
  }

  triggerState(currentState: TimedHassEntity): void {
    if (this.simulation.enabled || (this.simulation.enabled === undefined)) {
      this.updateEntityState(this.simulation.entity, currentState);
    }

    const currentIndex = this.simulation.states.indexOf(currentState);
    const nextIndex = (currentIndex + 1) % this.simulation.states.length;
    const nextState = this.simulation.states[nextIndex];

    if (nextState.duration) {
      setTimeout(this.triggerState.bind(this), currentState.duration * 1000, nextState);
    }
  }

  updateEntityState(entity: string | HassEntity, state: string | TimedHassEntity): void {
    const entityId = (typeof entity === 'string') ? entity : (entity as HassEntity).entity_id;

    const existingHassState = this.hass.states[entityId];

    let newHassState: HassEntity;

    if (existingHassState) {
      // Clone the existing state
      newHassState = Object.assign({}, existingHassState);
      newHassState.attributes = Object.assign({}, existingHassState.attributes);
    }
    else {
      // Create a new state
      newHassState = new HassEntity();
      newHassState.entity_id = entityId;
    }

    // Assign the new state
    if (typeof state === 'string') {
      newHassState.state = (typeof state === 'string' ? state : (state as TimedHassEntity).state);
    }
    else if (typeof state === 'object') {
      newHassState.state = (state as TimedHassEntity).state;

      if ((state as TimedHassEntity).attributes) {
        newHassState.attributes = Object.assign({}, newHassState.attributes, (state as TimedHassEntity).attributes);
      }
    }

    // Ensure the attributes object exists
    newHassState.attributes = newHassState.attributes ?? {};
    newHassState.attributes.friendly_name = newHassState.attributes?.friendly_name ?? entityId;

    // Update timestamps
    newHassState.last_changed = new Date().toString();
    newHassState.last_updated = new Date().toString();

    this.onEntityStatesChanged([newHassState]);
  }
}
