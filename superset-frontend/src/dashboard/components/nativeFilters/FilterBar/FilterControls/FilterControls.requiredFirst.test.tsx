/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import type { DataMaskStateWithId, Filter } from '@superset-ui/core';
import { FilterBarOrientation } from 'src/dashboard/types';
import { updateDataMask } from 'src/dataMask/actions';
import {
  act,
  createStore,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from 'spec/helpers/testing-library';
import reducerIndex from 'spec/helpers/reducerIndex';
import { createSelectNativeFilter } from 'spec/fixtures/mockNativeFilters';
import FilterControls from './FilterControls';

// The filter values themselves don't matter here. Recording the `inView` each
// one receives lets a test check filters that are not mounted on screen.
const mockInViewByFilterId: Record<string, boolean | undefined> = {};
jest.mock('./FilterValue', () => ({
  __esModule: true,
  default: ({ filter, inView }: { filter: Filter; inView?: boolean }) => {
    mockInViewByFilterId[filter.id] = inView;
    return null;
  },
}));

const ITEM_WIDTH = 100;
/* Room for three items, so three native filters fit until a chip is added. */
const ROW_WIDTH = 350;

const CHART_ID = 85;
const CHART_NAME = 'Sales by account';

/* Lays the filter bar row items out side by side at ITEM_WIDTH each. */
const mockBoundingRects = () => {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
      let left = 0;
      let width = 0;
      if (this.dataset.test === 'container') {
        width = ROW_WIDTH;
      } else if (this.parentElement?.dataset.test === 'container') {
        left =
          Array.from(this.parentElement.children).indexOf(this) * ITEM_WIDTH;
        width = ITEM_WIDTH;
      }
      return {
        bottom: 0,
        height: 0,
        left,
        right: left + width,
        top: 0,
        width,
        x: left,
        y: 0,
        toJSON: () => ({}),
      };
    });
};

const requiredFirstFilter = (id: string, name: string): Filter => ({
  ...createSelectNativeFilter(id, name),
  requiredFirst: true,
  controlValues: { defaultToFirstItem: true },
});

const renderHorizontalFilterBar = (filters: Filter[]) => {
  const store = createStore(
    {
      dashboardInfo: {
        id: 1,
        dash_edit_perm: true,
        filterBarOrientation: FilterBarOrientation.Horizontal,
        metadata: { native_filter_configuration: filters },
      },
      dashboardLayout: {
        present: {
          ROOT_ID: {
            type: 'ROOT',
            id: 'ROOT_ID',
            children: [`CHART-${CHART_ID}`],
          },
          [`CHART-${CHART_ID}`]: {
            type: 'CHART',
            id: `CHART-${CHART_ID}`,
            parents: ['ROOT_ID'],
            meta: { chartId: CHART_ID, sliceName: CHART_NAME },
          },
        },
        past: [],
        future: [],
      },
      dashboardState: { sliceIds: [CHART_ID], activeTabs: ['ROOT_ID'] },
      charts: {},
      nativeFilters: {
        filters: Object.fromEntries(filters.map(f => [f.id, f])),
        filtersState: {},
      },
      dataMask: {},
      sliceEntities: { slices: {} },
      datasources: {},
    },
    reducerIndex,
  );
  const dataMaskSelected = Object.fromEntries(
    filters.map(f => [
      f.id,
      { id: f.id, filterState: { value: null }, extraFormData: {} },
    ]),
  ) as DataMaskStateWithId;

  render(
    <FilterControls
      dataMaskSelected={dataMaskSelected}
      onFilterSelectionChange={jest.fn()}
      onPendingCustomizationDataMaskChange={jest.fn()}
      chartCustomizationValues={[]}
    />,
    { store, useRouter: true },
  );
  return store;
};

/* Same as clicking a row of the chart: prepends a cross-filter chip. */
const applyCrossFilter = (store: ReturnType<typeof createStore>) =>
  act(() => {
    store.dispatch(
      updateDataMask(CHART_ID, {
        filterState: { value: 'Acme', filters: { account: 'Acme' } },
        extraFormData: {},
      }),
    );
  });

const filterNamesIn = (element: HTMLElement) =>
  within(element)
    .queryAllByTestId('filter-control-name')
    .map(name => name.textContent);

beforeEach(() => {
  mockBoundingRects();
  Object.keys(mockInViewByFilterId).forEach(id => {
    delete mockInViewByFilterId[id];
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('native filters stay reachable after a cross-filter when a filter is requiredFirst', async () => {
  const store = renderHorizontalFilterBar([
    requiredFirstFilter('NATIVE_FILTER-1', 'Account'),
    createSelectNativeFilter('NATIVE_FILTER-2', 'Date range'),
    createSelectNativeFilter('NATIVE_FILTER-3', 'Flow'),
  ]);
  const row = screen.getByTestId('container');
  await waitFor(() =>
    expect(filterNamesIn(row)).toEqual(['Account', 'Date range', 'Flow']),
  );

  applyCrossFilter(store);

  const trigger = await screen.findByTestId('dropdown-container-btn');
  expect(within(row).getByText(CHART_NAME)).toBeInTheDocument();
  expect(filterNamesIn(row)).toEqual(['Account', 'Date range']);
  // The overflowed filter is not parked in a hidden, pre-rendered dropdown
  expect(screen.queryByTestId('dropdown-content')).not.toBeInTheDocument();

  await userEvent.click(trigger);
  expect(filterNamesIn(await screen.findByTestId('dropdown-content'))).toEqual([
    'Flow',
  ]);

  await userEvent.click(trigger);
  await waitFor(() =>
    expect(screen.queryByTestId('dropdown-content')).not.toBeInTheDocument(),
  );
  expect(filterNamesIn(row)).toEqual(['Account', 'Date range']);
});

test('requiredFirst filter in the closed "More filters" dropdown still loads its value', async () => {
  const store = renderHorizontalFilterBar([
    createSelectNativeFilter('NATIVE_FILTER-1', 'Date range'),
    createSelectNativeFilter('NATIVE_FILTER-2', 'Flow'),
    requiredFirstFilter('NATIVE_FILTER-3', 'Account'),
  ]);
  applyCrossFilter(store);

  await screen.findByTestId('dropdown-container-btn');
  expect(filterNamesIn(screen.getByTestId('container'))).toEqual([
    'Date range',
    'Flow',
  ]);
  expect(screen.queryByTestId('dropdown-content')).not.toBeInTheDocument();
  expect(mockInViewByFilterId['NATIVE_FILTER-3']).toBe(true);
});
